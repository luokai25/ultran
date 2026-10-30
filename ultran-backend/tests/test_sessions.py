"""Session management: list, read, clear, delete."""

from __future__ import annotations

import pytest

from ultran_backend.errors import NotFound, ValidationFailed
from tests.test_agents import service


def _chat(svc, agent, text, sid=None):
    return svc.chat(agent.id, text, session_id=sid, allow_tools=False)


def test_list_sessions_newest_first_and_scoped_to_agent():
    svc = service()
    a, b = svc.create(name="Alpha"), svc.create(name="Bravo")
    s1 = _chat(svc, a, "one")["session_id"]
    s2 = _chat(svc, a, "two")["session_id"]
    _chat(svc, b, "other")
    ids = [s.id for s in svc.list_sessions(a.id)]
    assert ids == [s2, s1]


def test_get_session_returns_transcript():
    svc = service()
    a = svc.create(name="Alpha")
    sid = _chat(svc, a, "hello there")["session_id"]
    sess = svc.get_session(a.id, sid)
    assert sess.messages[0].content == "hello there"
    assert sess.public()["turns"] == 1


def test_clear_session_keeps_id_but_drops_context():
    svc = service()
    a = svc.create(name="Alpha")
    sid = _chat(svc, a, "hello")["session_id"]
    cleared = svc.clear_session(a.id, sid)
    assert cleared.id == sid and cleared.messages == [] and cleared.turns == 0
    assert _chat(svc, a, "again", sid)["session_id"] == sid


def test_delete_session_removes_it():
    svc = service()
    a = svc.create(name="Alpha")
    sid = _chat(svc, a, "hello")["session_id"]
    svc.delete_session(a.id, sid)
    with pytest.raises(NotFound):
        svc.get_session(a.id, sid)


def test_session_of_another_agent_is_rejected():
    svc = service()
    a, b = svc.create(name="Alpha"), svc.create(name="Bravo")
    sid = _chat(svc, a, "hello")["session_id"]
    with pytest.raises(ValidationFailed):
        svc.delete_session(b.id, sid)


def test_session_endpoints_over_http(client):
    agent = client.post("/v1/agents", json={"name": "Alpha"}).json()
    sid = client.post(f"/v1/agents/{agent['id']}/chat", json={"message": "hi"}).json()["session_id"]
    listed = client.get(f"/v1/agents/{agent['id']}/sessions").json()
    assert [s["id"] for s in listed] == [sid]
    assert client.get(f"/v1/agents/{agent['id']}/sessions/{sid}").json()["messages"][0]["content"] == "hi"
    assert client.post(f"/v1/agents/{agent['id']}/sessions/{sid}/clear").json()["messages"] == []
    assert client.delete(f"/v1/agents/{agent['id']}/sessions/{sid}").status_code == 204
    assert client.get(f"/v1/agents/{agent['id']}/sessions/{sid}").status_code == 404
