from __future__ import annotations

import sqlite3
import threading
import time

import pytest
from cryptography.fernet import Fernet

from ultran_backend.errors import NotFound, ValidationFailed
from ultran_backend.tasks import AgentTaskService


def wait_for(service, task_id, states, timeout=3):
    deadline = time.time() + timeout
    while time.time() < deadline:
        task = service.get("workspace-a", task_id)
        if task.status in states:
            return task
        time.sleep(0.01)
    raise AssertionError(f"task did not reach {states}; got {service.get('workspace-a', task_id).status}")


def test_task_runs_and_persists_encrypted_result(tmp_path):
    key = Fernet.generate_key().decode("ascii")
    path = tmp_path / "tasks.sqlite3"
    service = AgentTaskService(path, lambda agent, message, **kw: {"content": f"done: {message}"}, encryption_key=key)
    task = service.submit("agent-1", "workspace-a", "private project data")
    completed = wait_for(service, task.id, {"succeeded"})
    assert completed.result["content"] == "done: private project data"
    service.close()
    raw = path.read_bytes()
    assert b"private project data" not in raw
    restored = AgentTaskService(path, lambda *a, **kw: {}, encryption_key=key)
    assert restored.get("workspace-a", task.id).status == "succeeded"
    with pytest.raises(NotFound):
        restored.get("workspace-b", task.id)
    restored.close()


def test_failed_task_requires_explicit_retry(tmp_path):
    calls = []
    def execute(agent, message, **kwargs):
        calls.append(message)
        if len(calls) == 1:
            raise RuntimeError("temporary provider outage")
        return {"content": "recovered"}
    service = AgentTaskService(tmp_path / "tasks.sqlite3", execute)
    task = service.submit("agent-1", "workspace-a", "run")
    failed = wait_for(service, task.id, {"failed"})
    assert failed.attempts == 1
    assert failed.error == "temporary provider outage"
    with pytest.raises(ValidationFailed):
        service.cancel("workspace-a", task.id)
    retried = service.retry("workspace-a", task.id)
    assert retried.status == "queued"
    assert wait_for(service, task.id, {"succeeded"}).attempts == 2
    assert calls == ["run", "run"]
    service.close()


def test_restart_marks_inflight_task_interrupted_and_requires_manual_retry(tmp_path):
    path = tmp_path / "tasks.sqlite3"
    first = AgentTaskService(path, lambda *a, **kw: {"ok": True})
    task = first.submit("agent-1", "workspace-a", "one")
    wait_for(first, task.id, {"succeeded"})
    first.close()
    with sqlite3.connect(path) as db:
        db.execute("UPDATE agent_tasks SET status='running' WHERE id=?", (task.id,))
    calls = []
    second = AgentTaskService(path, lambda *a, **kw: calls.append(True) or {"ok": True})
    assert second.get("workspace-a", task.id).status == "interrupted"
    assert calls == []
    second.retry("workspace-a", task.id)
    assert wait_for(second, task.id, {"succeeded"}).attempts == 2
    second.close()


def test_queued_task_can_be_cancelled_and_other_workspace_cannot_see_it(tmp_path):
    entered, release = threading.Event(), threading.Event()
    def execute(agent, message, **kwargs):
        entered.set(); release.wait(2); return {"ok": True}
    service = AgentTaskService(tmp_path / "tasks.sqlite3", execute, max_workers=1)
    first = service.submit("agent-1", "workspace-a", "blocking")
    assert entered.wait(2)
    queued = service.submit("agent-1", "workspace-a", "cancel me")
    assert service.cancel("workspace-a", queued.id).status == "cancelled"
    with pytest.raises(NotFound):
        service.get("workspace-b", first.id)
    release.set()
    wait_for(service, first.id, {"succeeded"})
    service.close()


def test_task_api_scopes_submit_list_and_status(client):
    agent = client.post("/v1/agents", json={"name": "Task API agent"}).json()
    headers = {"X-Ultran-Workspace": "workspace-a"}
    response = client.post("/v1/tasks", json={
        "agent_id": agent["id"], "message": "background check", "allow_tools": False,
    }, headers=headers)
    assert response.status_code == 202, response.text
    task_id = response.json()["id"]
    assert client.get("/v1/tasks", headers={"X-Ultran-Workspace": "workspace-b"}).json() == []
    assert client.get(f"/v1/tasks/{task_id}", headers=headers).status_code == 200
    assert client.get(f"/v1/tasks/{task_id}", headers={"X-Ultran-Workspace": "workspace-b"}).status_code == 404


def test_queued_task_resumes_after_restart(tmp_path):
    path = tmp_path / "tasks.sqlite3"
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    def first_executor(agent, message, **kwargs):
        if message == "hold":
            entered.set(); release.wait(2); finished.set()
        return {"message": message}
    first = AgentTaskService(path, first_executor, max_workers=1)
    running = first.submit("agent-1", "workspace-a", "hold")
    assert entered.wait(2)
    queued = first.submit("agent-1", "workspace-a", "resume me")
    first.close()
    release.set()
    assert finished.wait(2)

    resumed_calls = []
    second = AgentTaskService(path, lambda agent, message, **kw: resumed_calls.append(message) or {"ok": True})
    completed = wait_for(second, queued.id, {"succeeded"})
    assert completed.result == {"ok": True}
    assert resumed_calls == ["resume me"]
    second.close()
