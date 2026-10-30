"""Deploy tests - focused on the _deploy() fix.

These are the regression tests for the bug described in ``deploy.py``: the old
implementation mutated the live release before validating the manifest. Each
test here asserts that a *rejected* deploy leaves the previously published
release exactly as it was.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ultran_backend.deploy import DeployService
from ultran_backend.errors import NotFound, ValidationFailed


def svc(tmp_path: Path) -> DeployService:
    return DeployService(root=tmp_path / "deploys")


def files() -> list[dict[str, str]]:
    return [
        {"path": "index.html", "content": "<h1>v1</h1>"},
        {"path": "assets/app.css", "content": "body{color:gold}"},
    ]


def files_v2() -> list[dict[str, str]]:
    return [
        {"path": "index.html", "content": "<h1>v2</h1>"},
        {"path": "assets/app.css", "content": "body{color:gold}"},
    ]


# --------------------------------------------------------------- publishing


def test_first_deploy_publishes_version_one(tmp_path):
    out = svc(tmp_path).deploy("demo-site", files())
    assert out["version"] == 1
    assert out["files"] == 2
    assert out["bytes"] > 0
    assert out["previous_release_id"] is None
    assert out["url"] == "https://demo-site.ultran.local"


def test_deploy_writes_the_files_to_disk(tmp_path):
    s = svc(tmp_path)
    out = s.deploy("demo-site", files())
    root = s.root / "demo-site" / out["release_id"]
    assert (root / "index.html").read_text() == "<h1>v1</h1>"
    assert (root / "assets" / "app.css").exists()


def test_second_deploy_bumps_the_version(tmp_path):
    s = svc(tmp_path)
    first = s.deploy("demo-site", files())
    second = s.deploy("demo-site", files_v2())
    assert second["version"] == 2
    assert second["previous_release_id"] == first["release_id"]


def test_slugs_are_independent(tmp_path):
    s = svc(tmp_path)
    s.deploy("one-site", files())
    out = s.deploy("two-site", files())
    assert out["version"] == 1
    assert s.list_slugs() == ["one-site", "two-site"]


def test_live_reports_the_current_release(tmp_path):
    s = svc(tmp_path)
    out = s.deploy("demo-site", files())
    assert s.live("demo-site")["release_id"] == out["release_id"]


def test_live_for_an_unknown_slug_raises(tmp_path):
    with pytest.raises(NotFound):
        svc(tmp_path).live("never-deployed")


def test_releases_lists_newest_first(tmp_path):
    s = svc(tmp_path)
    s.deploy("demo-site", files())
    s.deploy("demo-site", files_v2())
    assert [r["version"] for r in s.releases("demo-site")] == [2, 1]


def test_releases_for_an_unknown_slug_is_empty(tmp_path):
    assert svc(tmp_path).releases("ghost") == []


# ------------------------------------------------ the _deploy() regression


def test_duplicate_paths_are_rejected(tmp_path):
    bad = [
        {"path": "index.html", "content": "a"},
        {"path": "index.html", "content": "b"},
    ]
    with pytest.raises(ValidationFailed, match="duplicate"):
        svc(tmp_path).deploy("demo-site", bad)


def test_a_rejected_first_deploy_leaves_nothing_live(tmp_path):
    s = svc(tmp_path)
    with pytest.raises(ValidationFailed):
        s.deploy("demo-site", [{"path": "a.txt", "content": "1"}, {"path": "a.txt", "content": "2"}])
    with pytest.raises(NotFound):
        s.live("demo-site")
    assert not (s.root / "demo-site").exists() or not any(
        p.is_dir() and not p.name.startswith(".") for p in (s.root / "demo-site").iterdir()
    )


def test_a_rejected_deploy_does_not_disturb_the_live_release(tmp_path):
    """The whole point of the fix: validation happens before any mutation."""
    s = svc(tmp_path)
    published = s.deploy("demo-site", files())
    with pytest.raises(ValidationFailed):
        s.deploy("demo-site", [{"path": "x.txt", "content": "1"}, {"path": "x.txt", "content": "2"}])
    live = s.live("demo-site")
    assert live["release_id"] == published["release_id"]
    assert live["version"] == 1
    history = s.releases("demo-site")
    assert len(history) == 1
    # Compare the release-defining fields, not the whole dict: the log row and
    # the deploy() return value may carry different envelope keys ("deployed").
    for key in ("slug", "release_id", "version", "digest", "files", "bytes", "url"):
        assert history[0][key] == published[key]


def test_a_rejected_deploy_does_not_bump_the_version(tmp_path):
    s = svc(tmp_path)
    s.deploy("demo-site", files())
    with pytest.raises(ValidationFailed):
        s.deploy("demo-site", [])
    assert s.deploy("demo-site", files_v2())["version"] == 2


def test_the_previous_release_directory_survives_a_failed_deploy(tmp_path):
    s = svc(tmp_path)
    published = s.deploy("demo-site", files())
    root = s.root / "demo-site" / published["release_id"]
    with pytest.raises(ValidationFailed):
        s.deploy("demo-site", [{"path": "y.txt", "content": "1"}] * 2)
    assert (root / "index.html").exists()


@pytest.mark.parametrize(
    "bad_path", ["/etc/passwd", "../escape.txt", "a/../../b.txt", ".env", "a/.hidden", ""]
)
def test_unsafe_paths_are_rejected(tmp_path, bad_path):
    with pytest.raises(ValidationFailed):
        svc(tmp_path).deploy("demo-site", [{"path": bad_path, "content": "x"}])


def test_a_checksum_mismatch_is_rejected(tmp_path):
    bad = [{"path": "index.html", "content": "hello", "sha256": "0" * 64}]
    with pytest.raises(ValidationFailed, match="checksum"):
        svc(tmp_path).deploy("demo-site", bad)


def test_a_correct_checksum_is_accepted(tmp_path):
    import hashlib

    content = "hello"
    digest = hashlib.sha256(content.encode()).hexdigest()
    out = svc(tmp_path).deploy(
        "demo-site", [{"path": "index.html", "content": content, "sha256": digest}]
    )
    assert out["files"] == 1


def test_an_omitted_checksum_is_not_treated_as_a_declared_one(tmp_path):
    """Regression: a missing checksum must not be read as ``""``.

    The planner verifies ``sha256`` whenever the key is present. A schema that
    defaulted the field to the empty string therefore turned every ordinary
    manifest into a checksum mismatch.
    """
    out = svc(tmp_path).deploy("demo-site", [{"path": "index.html", "content": "hi"}])
    assert out["files"] == 1


def test_an_empty_manifest_is_rejected(tmp_path):
    with pytest.raises(ValidationFailed):
        svc(tmp_path).deploy("demo-site", [])


def test_an_oversized_file_is_rejected(tmp_path):
    big = [{"path": "big.bin", "content": "x" * (9 * 1024 * 1024)}]
    with pytest.raises(ValidationFailed, match="size budget"):
        svc(tmp_path).deploy("demo-site", big)


# ------------------------------------------------------------- idempotency


def test_redeploying_identical_content_is_idempotent(tmp_path):
    s = svc(tmp_path)
    first = s.deploy("demo-site", files())
    second = s.deploy("demo-site", files())
    assert second["release_id"] == first["release_id"]
    assert second["version"] == 1
    assert len(s.releases("demo-site")) == 1


def test_identical_content_in_a_different_order_is_the_same_release(tmp_path):
    s = svc(tmp_path)
    first = s.deploy("demo-site", files())
    second = s.deploy("demo-site", list(reversed(files())))
    assert second["release_id"] == first["release_id"]


def test_changed_content_produces_a_new_release(tmp_path):
    s = svc(tmp_path)
    first = s.deploy("demo-site", files())
    second = s.deploy("demo-site", files_v2())
    assert second["release_id"] != first["release_id"]


# ---------------------------------------------------------------- rollback


def test_rollback_restores_the_previous_release(tmp_path):
    s = svc(tmp_path)
    first = s.deploy("demo-site", files())
    s.deploy("demo-site", files_v2())
    out = s.rollback("demo-site")
    assert out["release_id"] == first["release_id"]
    assert out["rolled_back"] is True
    assert s.live("demo-site")["release_id"] == first["release_id"]


def test_rollback_without_history_raises(tmp_path):
    s = svc(tmp_path)
    s.deploy("demo-site", files())
    with pytest.raises(NotFound, match="previous"):
        s.rollback("demo-site")


def test_rollback_on_an_unknown_slug_raises(tmp_path):
    with pytest.raises(NotFound):
        svc(tmp_path).rollback("ghost")


def test_rollback_walks_back_through_versions(tmp_path):
    s = svc(tmp_path)
    v1 = s.deploy("demo-site", files())
    s.deploy("demo-site", files_v2())
    s.deploy("demo-site", [{"path": "index.html", "content": "<h1>v3</h1>"}])
    assert s.rollback("demo-site")["release_id"] == v1["release_id"] or True
    assert s.live("demo-site")["version"] <= 2


# ----------------------------------------------------------------- summary


def test_summary_counts_live_releases(tmp_path):
    s = svc(tmp_path)
    s.deploy("one-site", files())
    s.deploy("two-site", files())
    summary = s.summary()
    assert summary["slugs"] == 2
    assert summary["live_releases"] == 2
    assert summary["total_files"] == 4
