"""Builder tests: every target emits compiling source."""

from __future__ import annotations

import ast
import json

import pytest

from ultran_backend.builder import TEMPLATES, TARGETS, BuilderService
from ultran_backend.errors import NotFound, ValidationFailed


def svc() -> BuilderService:
    return BuilderService()


@pytest.mark.parametrize("target", sorted(TARGETS))
def test_every_target_builds(target):
    art = svc().build(target=target, template="blank", slug="my-app")
    assert art.target == target
    assert art.file_count >= 2
    assert art.bytes > 0
    assert "README.md" in art.files


def test_web_target_ships_html_css_and_js():
    art = svc().build(target="web", template="landing", slug="my-app")
    assert art.files["index.html"].startswith("<!doctype html>")
    assert "styles/theme.css" in art.files
    assert "app.js" in art.files


def test_web_page_uses_the_golden_black_palette():
    html = svc().build(target="web", template="blank", slug="my-app").files["index.html"]
    assert "#d4af37" in html
    assert "#050505" in html


def test_features_become_rendered_cards():
    html = svc().build(
        target="web", template="landing", slug="my-app", features=["Billing", "Deploys"]
    ).files["index.html"]
    assert "Billing" in html
    assert "Deploys" in html


def test_api_target_emits_parseable_python():
    art = svc().build(target="api", template="blank", slug="my-api")
    ast.parse(art.files["main.py"])  # raises on syntax error
    assert "FastAPI" in art.files["main.py"]


def test_api_target_slug_is_baked_in():
    art = svc().build(target="api", template="blank", slug="my-api")
    assert "my-api" in art.files["main.py"]


def test_function_target_emits_parseable_worker():
    art = svc().build(target="function", template="worker", slug="my-worker")
    ast.parse(art.files["handler.py"])
    assert "MAX_ATTEMPTS" in art.files["handler.py"]


def test_function_worker_has_bounded_retries():
    src = svc().build(target="function", template="worker", slug="my-worker").files["handler.py"]
    assert "dead_letter" in src
    assert "attempt + 1" in src


def test_desktop_target_emits_valid_package_json():
    art = svc().build(target="desktop", template="blank", slug="my-desktop")
    pkg = json.loads(art.files["package.json"])
    assert pkg["name"] == "my-desktop"
    assert "electron" in art.files["main.js"]


def test_mobile_target_emits_valid_package_json():
    art = svc().build(target="mobile", template="blank", slug="my-mobile")
    pkg = json.loads(art.files["package.json"])
    assert pkg["name"] == "my-mobile"
    assert "react-native" in art.files["App.js"]


def test_readme_records_template_target_and_features():
    readme = svc().build(
        target="web", template="dashboard", slug="my-app", features=["Charts"]
    ).files["README.md"]
    assert "dashboard" in readme
    assert "web" in readme
    assert "Charts" in readme


def test_builds_are_retrievable_by_id():
    s = svc()
    art = s.build(target="web", template="blank", slug="my-app")
    assert s.get(art.id).id == art.id


def test_missing_build_raises():
    with pytest.raises(NotFound):
        svc().get("bld_ghost")


def test_builds_list_is_newest_first():
    s = svc()
    first = s.build(target="web", template="blank", slug="one-app")
    second = s.build(target="web", template="blank", slug="two-app")
    assert [a.id for a in s.list()] == [second.id, first.id]


def test_unknown_target_is_rejected():
    with pytest.raises(ValidationFailed, match="target"):
        svc().build(target="toaster", template="blank", slug="my-app")


def test_unknown_template_is_rejected():
    with pytest.raises(ValidationFailed, match="template"):
        svc().build(target="web", template="nope", slug="my-app")


def test_blank_slug_is_rejected():
    with pytest.raises(ValidationFailed, match="slug"):
        svc().build(target="web", template="blank", slug="   ")


def test_there_are_five_targets_and_five_templates():
    assert len(TARGETS) == 5
    assert len(TEMPLATES) == 5


def test_bytes_matches_the_actual_file_content():
    art = svc().build(target="web", template="blank", slug="my-app")
    expected = sum(len(v.encode("utf-8")) for v in art.files.values())
    assert art.bytes == expected
