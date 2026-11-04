"""Content-addressed, non-executing staging for reviewed generated-tool source.

This store writes source and review metadata only. It never imports, compiles to
a .pyc file, or executes staged code. The worker supervisor owns later transfer
into a real isolated execution environment.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

from .generated_tool_registry import ReviewedToolCandidate

HASH_RE = re.compile(r"^[a-f0-9]{64}$")


class GeneratedToolArtifactError(RuntimeError):
    pass


class GeneratedToolArtifactStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.root.is_symlink() or not self.root.is_dir():
            raise GeneratedToolArtifactError("Artifact root must be a real directory, not a symlink.")
        os.chmod(self.root, 0o700)

    def stage(self, reviewed: ReviewedToolCandidate) -> Path:
        digest = reviewed.source_hash
        if not HASH_RE.fullmatch(digest):
            raise GeneratedToolArtifactError("Reviewed source hash is invalid.")
        source = reviewed.candidate.source.encode("utf-8")
        if hashlib.sha256(source).hexdigest() != digest:
            raise GeneratedToolArtifactError("Source bytes no longer match the reviewed fingerprint.")
        directory = self.root / digest
        try:
            directory.mkdir(mode=0o700, exist_ok=True)
            if directory.is_symlink() or not directory.resolve().is_relative_to(self.root.resolve()):
                raise GeneratedToolArtifactError("Staging path escaped the configured artifact root.")
            source_path = directory / "source.py"
            self._write_once(source_path, source)
            manifest = {
                "tool_id": reviewed.candidate.tool_id,
                "version": reviewed.candidate.version,
                "source_sha256": digest,
                "approval_fingerprint": reviewed.approval_fingerprint,
                "execution": "not_executed",
            }
            manifest_path = directory / "review.json"
            self._write_once(
                manifest_path,
                json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8"),
            )
            return source_path
        except OSError as exc:
            raise GeneratedToolArtifactError("Could not safely stage the reviewed candidate.") from exc

    @staticmethod
    def _write_once(path: Path, content: bytes) -> None:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            descriptor = os.open(path, flags, 0o600)
        except FileExistsError:
            if path.is_symlink() or not path.is_file() or path.read_bytes() != content:
                raise GeneratedToolArtifactError("Existing staged artifact does not match the reviewed bytes.")
            return
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "wb", closefd=False) as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
        finally:
            os.close(descriptor)
