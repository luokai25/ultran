"""Atomic, content-idempotent, reversible site deploys.

Why this module exists
----------------------
The first version of ``_deploy()`` wrote each file straight into the live slot
as it walked the manifest. Three things went wrong with that:

* **Torn publishes.** A manifest with a bad path failed halfway through, leaving
the site live but half-written - worse than a failed deploy.
* **A destroyed rollback point.** The previous release's directory had already
  been overwritten, so ``rollback()`` had nothing left to restore.
* **Duplicate releases.** A client that retried a request after a timeout
  published version *n+1* with byte-identical content.

The current implementation fixes all three:

1. **Validate before mutating.** The manifest is normalised into an immutable
   :class:`ReleasePlan` first. Any bad path, duplicate entry, oversize file or
   checksum mismatch raises *here*, while the live release is still untouched.
2. **Stage, then swap.** Bytes go to a staging directory, are re-hashed from
disk, and only then renamed into the live slot.
3. **Content-address the release.** ``release_id`` is derived from the content
   digest, so identical bytes are the same release no matter how often they are
   deployed.
4. **Roll back on failure.** If promotion raises, the previous pointer is
   restored and the original exception re-raised.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

from .errors import NotFound, ValidationFailed

MAX_FILES = 400
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")
HIDDEN_PREFIXES = (".", "_")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class PlannedFile:
    """A file that passed validation, normalised to a safe relative POSIX path."""

    path: str
    content: str
    digest: str

    @property
    def size(self) -> int:
        return len(self.content.encode("utf-8"))


@dataclass(frozen=True)
class ReleasePlan:
    slug: str
    files: tuple[PlannedFile, ...]
    total_bytes: int
    digest: str


def _normalise_path(raw: str) -> str:
    """Reject anything that could escape the release root."""
    if not isinstance(raw, str) or not raw.strip():
        raise ValidationFailed("file path must be a non-empty string", details={"path": raw})
    candidate = raw.strip().replace("\\", "/")
    if candidate.startswith("/"):
        raise ValidationFailed("absolute paths are not allowed", details={"path": raw})
    pure = PurePosixPath(candidate)
    if any(part == ".." for part in pure.parts):
        raise ValidationFailed("path traversal is not allowed", details={"path": raw})
    if any(part in {"", "."} for part in pure.parts):
        raise ValidationFailed("path must not contain empty segments", details={"path": raw})
    if any(part.startswith(HIDDEN_PREFIXES) for part in pure.parts):
        raise ValidationFailed(
            "hidden or underscore-prefixed paths are not publishable", details={"path": raw}
        )
    normalised = str(pure)
    if normalised in {"", "."}:
        raise ValidationFailed("file path is empty after normalisation", details={"path": raw})
    return normalised


def content_digest(files: Iterable[PlannedFile]) -> str:
    """Digest over the *sorted* (path, digest) pairs - order independent."""
    h = hashlib.sha256()
    for f in sorted(files, key=lambda x: x.path):
        h.update(f.path.encode("utf-8"))
        h.update(b"\0")
        h.update(f.digest.encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()


def plan_release(slug: str, files: list[dict[str, Any]]) -> ReleasePlan:
    """Validate a manifest into an immutable plan. Mutates nothing on disk."""
    if not isinstance(slug, str) or not SLUG_RE.match(slug):
        raise ValidationFailed(
            "slug must be 3-63 lowercase alphanumeric characters or hyphens",
            details={"slug": slug},
        )
    if not files:
        raise ValidationFailed("a deploy needs at least one file")
    if len(files) > MAX_FILES:
        raise ValidationFailed(
            "too many files in one deploy", details={"count": len(files), "max": MAX_FILES}
        )

    seen: set[str] = set()
    planned: list[PlannedFile] = []
    total = 0

    for entry in files:
        if not isinstance(entry, dict):
            raise ValidationFailed("each file entry must be an object")
        path = _normalise_path(entry.get("path", ""))
        if path in seen:
            raise ValidationFailed("duplicate path in manifest", details={"path": path})
        seen.add(path)

        content = entry.get("content", "")
        if not isinstance(content, str):
            raise ValidationFailed("file content must be a string", details={"path": path})
        data = content.encode("utf-8")
        if len(data) > MAX_FILE_BYTES:
            raise ValidationFailed(
                "file exceeds the per-file size budget",
                details={"path": path, "bytes": len(data), "max": MAX_FILE_BYTES},
            )
        total += len(data)
        digest = hashlib.sha256(data).hexdigest()

        declared = entry.get("sha256")
        if declared is not None and declared != digest:
            raise ValidationFailed(
                "checksum mismatch",
                details={"path": path, "declared": declared, "actual": digest},
            )
        planned.append(PlannedFile(path=path, content=content, digest=digest))

    if total > MAX_TOTAL_BYTES:
        raise ValidationFailed(
            "deploy exceeds the total size budget",
            details={"bytes": total, "max": MAX_TOTAL_BYTES},
        )
    if "index.html" not in seen and not any(p.endswith(".html") for p in seen):
        raise ValidationFailed("a deploy needs at least one .html entry point")

    return ReleasePlan(
        slug=slug,
        files=tuple(planned),
        total_bytes=total,
        digest=content_digest(planned),
    )


def _write_atomic(root: Path, rel: str, content: str) -> None:
    """Write one file, creating parents, never leaving a partial file behind."""
    target = root / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=".tmp-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(content)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, target)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


class DeployService:
    """Publishes releases into ``root/<slug>/<release_id>``."""

    def __init__(self, root: Path | str = ".ultran-deploys") -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ #
    def _site_dir(self, slug: str) -> Path:
        if not SLUG_RE.match(slug):
            raise NotFound("site not found", details={"slug": slug})
        return self.root / slug

    def _live_pointer(self, slug: str) -> Path:
        return self._site_dir(slug) / "live.json"

    def _read_pointer(self, slug: str) -> dict[str, Any]:
        pointer = self._live_pointer(slug)
        if not pointer.exists():
            raise NotFound("nothing has been deployed to this slug", details={"slug": slug})
        try:
            return json.loads(pointer.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:  # pragma: no cover - corrupt pointer
            raise NotFound("live pointer is unreadable", details={"slug": slug}) from exc

    def _write_pointer(self, slug: str, payload: dict[str, Any]) -> None:
        pointer = self._live_pointer(slug)
        pointer.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(pointer.parent), prefix=".ptr-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(payload, fh)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, pointer)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    # ------------------------------------------------------------------ #
    def deploy(self, slug: str, files: list[dict[str, Any]]) -> dict[str, Any]:
        """Validate, stage, promote. A failure leaves the live release intact."""
        plan = plan_release(slug, files)  # <- raises before any mutation
        site = self._site_dir(plan.slug)
        site.mkdir(parents=True, exist_ok=True)

        previous: dict[str, Any] | None
        try:
            previous = self._read_pointer(plan.slug)
        except NotFound:
            previous = None

        release_id = f"rel_{plan.digest[:16]}"

        # Idempotency: identical content is the same release.
        if previous and previous.get("release_id") == release_id:
            return {
                **previous,
                "deployed": False,
                "reason": "identical content already live",
            }

        final_dir = site / release_id
        if final_dir.exists():
            # The bytes are already on disk from an earlier release that is not
            # currently live; just re-point at it.
            version = previous["version"] + 1 if previous else 1
        else:
            staging = Path(tempfile.mkdtemp(dir=str(site), prefix=".staging-"))
            try:
                for f in plan.files:
                    _write_atomic(staging, f.path, f.content)
                for f in plan.files:
                    on_disk = hashlib.sha256((staging / f.path).read_bytes()).hexdigest()
                    if on_disk != f.digest:
                        raise ValidationFailed(
                            "staged bytes do not match the plan", details={"path": f.path}
                        )
                os.replace(staging, final_dir)
            except BaseException:
                shutil.rmtree(staging, ignore_errors=True)
                raise
            version = previous["version"] + 1 if previous else 1

        record = {
            "slug": plan.slug,
            "release_id": release_id,
            "version": version,
            "files": len(plan.files),
            "bytes": plan.total_bytes,
            "digest": plan.digest,
            "url": f"https://{plan.slug}.ultran.local",
            "previous_release_id": previous.get("release_id") if previous else None,
            "deployed_at": utcnow().isoformat(),
        }

        try:
            self._write_pointer(plan.slug, record)
        except BaseException:
            # Promotion failed: restore the previous pointer so the live site and
            # its rollback point are exactly what they were before this call.
            if previous is not None:
                self._write_pointer(plan.slug, previous)
            raise

        with (site / "releases.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
        return {**record, "deployed": True}

    def live(self, slug: str) -> dict[str, Any]:
        return self._read_pointer(slug)

    def releases(self, slug: str) -> list[dict[str, Any]]:
        log = self._site_dir(slug) / "releases.jsonl"
        if not log.exists():
            return []
        rows: list[dict[str, Any]] = []
        for line in log.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                rows.append(json.loads(line))
        return list(reversed(rows))

    def list_slugs(self) -> list[str]:
        if not self.root.exists():
            return []
        return sorted(
            p.name for p in self.root.iterdir() if p.is_dir() and not p.name.startswith(".")
        )

    def rollback(self, slug: str) -> dict[str, Any]:
        current = self._read_pointer(slug)
        previous_id = current.get("previous_release_id")
        if not previous_id:
            raise NotFound("no previous release to roll back to", details={"slug": slug})
        history = self.releases(slug)
        target = next((r for r in history if r["release_id"] == previous_id), None)
        if target is None:
            raise NotFound("previous release is no longer in the log", details={"slug": slug})

        restored = {
            **target,
            "previous_release_id": current["release_id"],
            "deployed_at": utcnow().isoformat(),
        }
        self._write_pointer(slug, restored)
        with (self._site_dir(slug) / "releases.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({**restored, "rolled_back": True}) + "\n")
        return {**restored, "rolled_back": True}

    def summary(self) -> dict[str, Any]:
        slugs = self.list_slugs()
        live = 0
        files = 0
        for slug in slugs:
            try:
                record = self._read_pointer(slug)
            except NotFound:
                continue
            live += 1
            files += int(record.get("files", 0))
        return {"slugs": len(slugs), "live_releases": live, "total_files": files}
