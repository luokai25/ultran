"""Durable background execution for agent chat tasks."""
from __future__ import annotations
import json, sqlite3, threading, time, uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from .connectors.credentials import utcnow
from .errors import NotFound, ValidationFailed

@dataclass
class AgentTask:
    id: str
    agent_id: str
    workspace_id: str
    message: str
    allow_tools: bool
    max_tool_calls: int
    status: str = "queued"
    attempts: int = 0
    result: dict[str, Any] | None = None
    error: str = ""
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "agent_id": self.agent_id, "workspace_id": self.workspace_id,
                "message": self.message, "allow_tools": self.allow_tools,
                "max_tool_calls": self.max_tool_calls, "status": self.status,
                "attempts": self.attempts, "result": self.result, "error": self.error,
                "created_at": self.created_at, "updated_at": self.updated_at}

class AgentTaskService:
    """SQLite-backed agent task queue with bounded retries and restart recovery."""
    def __init__(self, db_path: str | Path, execute: Callable[..., dict[str, Any]],
                 *, encryption_key: str = "", max_workers: int = 2, max_attempts: int = 5) -> None:
        self._path = Path(db_path)
        self._execute = execute
        self._max_attempts = max(1, min(int(max_attempts), 5))
        self._lock = threading.RLock()
        self._tasks: dict[str, AgentTask] = {}
        self._futures = {}
        self._executor = ThreadPoolExecutor(max_workers=max(1, min(max_workers, 4)), thread_name_prefix="ultran-task")
        self._fernet = None
        if encryption_key:
            from cryptography.fernet import Fernet
            self._fernet = Fernet(encryption_key.encode("ascii"))
        self._path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._init_db()
        self._load()
        self.resume()

    def _connect(self):
        db = sqlite3.connect(self._path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=10000")
        return db

    def _encode(self, value: str) -> str:
        return self._fernet.encrypt(value.encode()).decode("ascii") if self._fernet else value

    def _decode(self, value: str) -> str:
        if not self._fernet: return value
        try: return self._fernet.decrypt(value.encode("ascii")).decode()
        except Exception as exc:
            raise RuntimeError("stored agent tasks cannot be decrypted; check ULTRAN_CREDENTIAL_ENCRYPTION_KEY") from exc

    def _init_db(self):
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS agent_tasks (
                id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
                message TEXT NOT NULL, allow_tools INTEGER NOT NULL, max_tool_calls INTEGER NOT NULL,
                status TEXT NOT NULL, attempts INTEGER NOT NULL, result TEXT, error TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
            db.execute("CREATE INDEX IF NOT EXISTS idx_agent_tasks_workspace ON agent_tasks(workspace_id, created_at DESC)")
        try: self._path.chmod(0o600)
        except OSError: pass

    def _persist(self, task: AgentTask):
        with self._connect() as db:
            db.execute("""INSERT INTO agent_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET status=excluded.status, attempts=excluded.attempts,
                result=excluded.result, error=excluded.error, updated_at=excluded.updated_at""",
                (task.id, task.agent_id, task.workspace_id, self._encode(task.message),
                 int(task.allow_tools), task.max_tool_calls, task.status, task.attempts,
                 self._encode(json.dumps(task.result, ensure_ascii=False)) if task.result is not None else None,
                 self._encode(task.error), task.created_at.isoformat(), task.updated_at.isoformat()))

    def _load(self):
        with self._connect() as db:
            rows = db.execute("SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT 500").fetchall()
        for row in rows:
            status = row["status"]
            if status in {"running", "retrying"}: status = "interrupted"
            task = AgentTask(row["id"], row["agent_id"], row["workspace_id"], self._decode(row["message"]),
                bool(row["allow_tools"]), row["max_tool_calls"], status, row["attempts"],
                json.loads(self._decode(row["result"])) if row["result"] else None,
                self._decode(row["error"]), datetime.fromisoformat(row["created_at"]), utcnow())
            self._tasks[task.id] = task
            if task.status == "interrupted": self._persist(task)

    def submit(self, agent_id: str, workspace_id: str, message: str, *,
               allow_tools: bool = True, max_tool_calls: int = 4) -> AgentTask:
        if not message.strip() or len(message) > 16000:
            raise ValidationFailed("task message must contain 1 to 16000 characters")
        if not 0 <= max_tool_calls <= 16:
            raise ValidationFailed("max_tool_calls must be between 0 and 16")
        task = AgentTask("task_" + uuid.uuid4().hex[:16], agent_id, workspace_id,
                         message.strip(), bool(allow_tools), max_tool_calls)
        with self._lock:
            self._tasks[task.id] = task
            self._persist(task)
        self._schedule(task.id)
        return task

    def _schedule(self, task_id: str):
        with self._lock:
            task = self._tasks.get(task_id)
            if task and task.status == "queued" and task_id not in self._futures:
                self._futures[task_id] = self._executor.submit(self._run, task_id)

    def resume(self) -> int:
        with self._lock: ids = [t.id for t in self._tasks.values() if t.status == "queued"]
        for task_id in ids: self._schedule(task_id)
        return len(ids)

    def _run(self, task_id: str):
        try:
            with self._lock:
                task = self._tasks.get(task_id)
                if task is None or task.status != "queued":
                    return
                task.status, task.attempts, task.updated_at = "running", task.attempts + 1, utcnow()
                self._persist(task)
            try:
                result = self._execute(task.agent_id, task.message, session_id=None,
                    workspace_id=task.workspace_id, allow_tools=task.allow_tools,
                    max_tool_calls=task.max_tool_calls)
                with self._lock:
                    task.result, task.status, task.error, task.updated_at = result, "succeeded", "", utcnow()
                    self._persist(task)
            except Exception as exc:
                with self._lock:
                    # Do not blindly replay a failed agent run: it may have completed
                    # a side effect before the exception. Retries require an explicit
                    # human action and each write tool still passes its approval gate.
                    task.error, task.status, task.updated_at = str(exc)[:2000], "failed", utcnow()
                    self._persist(task)
        finally:
            with self._lock:
                self._futures.pop(task_id, None)


    def get(self, workspace_id: str, task_id: str) -> AgentTask:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None or task.workspace_id != workspace_id:
                raise NotFound("task not found", details={"task_id": task_id})
            return task

    def list(self, workspace_id: str, *, limit: int = 50) -> list[AgentTask]:
        with self._lock: rows = [t for t in self._tasks.values() if t.workspace_id == workspace_id]
        return sorted(rows, key=lambda t: t.created_at, reverse=True)[:max(0, min(limit, 200))]

    def cancel(self, workspace_id: str, task_id: str) -> AgentTask:
        with self._lock:
            task = self.get(workspace_id, task_id)
            if task.status != "queued":
                raise ValidationFailed("only queued tasks can be cancelled", details={"status": task.status})
            task.status, task.updated_at = "cancelled", utcnow()
            self._persist(task)
            future = self._futures.get(task_id)
            if future: future.cancel()
            return task

    def retry(self, workspace_id: str, task_id: str) -> AgentTask:
        with self._lock:
            task = self.get(workspace_id, task_id)
            if task.status not in {"failed", "interrupted"}:
                raise ValidationFailed("only failed or interrupted tasks can be retried", details={"status": task.status})
            if task.attempts >= self._max_attempts:
                raise ValidationFailed("task has reached the five-attempt safety limit")
            task.status, task.error, task.updated_at = "queued", "", utcnow()
            self._persist(task)
        self._schedule(task_id)
        return task

    def close(self):
        self._executor.shutdown(wait=False, cancel_futures=True)
