from __future__ import annotations

import zipfile
from pathlib import Path

from ultran_backend.artifacts import ArtifactService


def test_artifacts_are_persistent_and_workspace_scoped(tmp_path: Path):
    service = ArtifactService(tmp_path / "artifacts")
    created = service.create("workspace-a", "Project brief", "md", "# Brief\n\nHello")
    assert created["format"] == "md"
    assert created["size"] > 0
    restarted = ArtifactService(tmp_path / "artifacts")
    assert restarted.get("workspace-a", created["id"])["title"] == "Project brief"
    assert restarted.list("workspace-b") == []
    try:
        restarted.get("workspace-b", created["id"])
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 404
    else:
        raise AssertionError("cross-workspace artifact access should fail")


def test_pdf_and_pptx_are_real_files(tmp_path: Path):
    service = ArtifactService(tmp_path)
    pdf = service.create("ws", "Report", "pdf", "First paragraph\nSecond paragraph")
    pdf_path = Path(service.get("ws", pdf["id"])["path"])
    assert pdf_path.read_bytes().startswith(b"%PDF-1.4")
    pptx = service.create("ws", "Deck", "pptx", "# Overview\nFirst slide\n# Results\nSecond slide")
    pptx_path = Path(service.get("ws", pptx["id"])["path"])
    assert zipfile.is_zipfile(pptx_path)
    import xml.etree.ElementTree as ET
    with zipfile.ZipFile(pptx_path) as archive:
        assert "ppt/slides/slide1.xml" in archive.namelist()
        assert "ppt/slides/slide2.xml" in archive.namelist()
        assert "ppt/theme/theme1.xml" in archive.namelist()
        for name in archive.namelist():
            if name.endswith(".xml") or name.endswith(".rels"):
                ET.fromstring(archive.read(name))


def test_json_validation_and_safe_title(tmp_path: Path):
    service = ArtifactService(tmp_path)
    try:
        service.create("ws", "../bad/name", "json", "not json")
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 422
    else:
        raise AssertionError("invalid JSON must be rejected")
    created = service.create("ws", "../Quarterly Report", "txt", "hello")
    assert "/../" not in service.get("ws", created["id"])["path"]


def test_artifact_api_download_and_workspace_isolation(client):
    response = client.post("/v1/artifacts", headers={"X-Ultran-Workspace": "alpha"}, json={
        "title": "My page", "format": "html", "content": "A safe page"
    })
    assert response.status_code == 201
    artifact = response.json()
    preview = client.get(artifact["preview_url"], headers={"X-Ultran-Workspace": "alpha"})
    assert preview.status_code == 200
    assert "A safe page" in preview.text
    blocked = client.get(artifact["download_url"], headers={"X-Ultran-Workspace": "beta"})
    assert blocked.status_code == 404


def test_agent_chat_creates_requested_file_artifact(client):
    created = client.post("/v1/agents", json={"name": "File Maker", "brain": "echo", "tools": []})
    assert created.status_code == 201
    agent_id = created.json()["id"]
    response = client.post(f"/v1/agents/{agent_id}/chat", json={
        "message": "Create a PDF about renewable energy"
    })
    assert response.status_code == 200
    body = response.json()
    artifact_calls = [call for call in body["tool_calls"] if call["connector"] == "artifacts"]
    assert len(artifact_calls) == 1
    assert artifact_calls[0]["artifact"]["format"] == "pdf"
    assert "Download" in body["content"]


def test_docx_and_xlsx_are_openxml_packages(tmp_path: Path):
    import xml.etree.ElementTree as ET
    service = ArtifactService(tmp_path)
    docx = service.create("ws", "Letter", "docx", "Hello\nWorld")
    xlsx = service.create("ws", "Data", "xlsx", "Name,Score\nAda,99\nLinus,98")
    for item in (docx, xlsx):
        path = Path(service.get("ws", item["id"])["path"])
        assert zipfile.is_zipfile(path)
    with zipfile.ZipFile(service.get("ws", docx["id"])["path"]) as archive:
        assert "word/document.xml" in archive.namelist()
        for name in archive.namelist():
            if name.endswith(".xml") or name.endswith(".rels"):
                ET.fromstring(archive.read(name))
    with zipfile.ZipFile(service.get("ws", xlsx["id"])["path"]) as archive:
        assert "xl/worksheets/sheet1.xml" in archive.namelist()
        for name in archive.namelist():
            if name.endswith(".xml") or name.endswith(".rels"):
                ET.fromstring(archive.read(name))


def test_unified_catalog_search_and_pagination(client):
    first = client.get("/v1/tools/catalog?query=pdf&limit=1")
    assert first.status_code == 200
    body = first.json()
    assert body["total"] >= 1
    assert body["tools"][0]["id"] == "artifacts.create_pdf"
    assert body["count"] == 1
    assert body["has_more"] is False or body["offset"] == 0


def test_html_preview_strips_active_content(tmp_path: Path):
    service = ArtifactService(tmp_path)
    artifact = service.create("ws", "Safe page", "html", "<h1>Hello</h1><script>alert(1)</script><p>Safe</p><a href='javascript:alert(1)'>bad</a>")
    body = Path(service.get("ws", artifact["id"])["path"]).read_text("utf-8")
    assert "Hello" in body and "Safe" in body
    assert "<script" not in body and "javascript:" not in body


def test_native_file_creation_is_not_blocked_by_connector_tool_budget(client):
    created = client.post("/v1/agents", json={"name": "No Connectors", "brain": "echo", "tools": []})
    agent_id = created.json()["id"]
    response = client.post(f"/v1/agents/{agent_id}/chat", json={
        "message": "Make a PDF about oceans", "allow_tools": False, "max_tool_calls": 0
    })
    assert response.status_code == 200
    artifact_calls = [call for call in response.json()["tool_calls"] if call["connector"] == "artifacts"]
    assert len(artifact_calls) == 1
    assert artifact_calls[0]["artifact"]["format"] == "pdf"


def test_tool_catalog_has_native_file_generators(client):
    response = client.get("/v1/tools/catalog?source=native&limit=100")
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["tools"]}
    assert {"artifacts.create_pdf", "artifacts.create_pptx", "artifacts.create_docx", "artifacts.create_xlsx"} <= ids


def test_chat_stream_emits_progress_and_final_result(client):
    created = client.post("/v1/agents", json={"name": "Stream Agent", "brain": "echo", "tools": []})
    agent_id = created.json()["id"]
    response = client.post(f"/v1/agents/{agent_id}/chat/stream", json={"message": "Create a PDF about ocean conservation"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    body = response.text
    assert '"type": "thinking"' in body
    assert '"type": "tool_started"' in body
    assert '"type": "artifact_created"' in body
    assert '"type": "completed"' in body
    assert '"type": "final"' in body
    assert '"content":' in body
