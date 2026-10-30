"""End-to-end HTTP tests against the assembled FastAPI app."""

from __future__ import annotations

import pytest

KEY = "sk-test-abcdefgh-1234"


# ---------------------------------------------------------------- the shell


def test_root_advertises_the_service(client):
    body = client.get("/").json()
    assert body["service"] == "ultran-backend"


def test_health_is_ok(client):
    body = client.get("/v1/health").json()
    assert body["status"] == "ok"
    assert body["version"]


def test_readiness_reports_capability(client):
    body = client.get("/v1/readiness").json()
    assert body["ready"] is True
    assert body["checks"]["connectors"] is True


# ---------------------------------------------------------------------- CORS
# The web workspace is a separate origin; without these headers the browser
# never sees a response at all, however correct the handler is.


def test_a_configured_origin_is_allowed_to_preflight(client):
    resp = client.options(
        "/v1/connectors",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp.status_code in (200, 204)
    assert resp.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_a_simple_request_echoes_the_allowed_origin(client):
    resp = client.get("/v1/health", headers={"Origin": "http://127.0.0.1:3000"})
    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"


def test_an_unknown_origin_is_not_granted_access(client):
    resp = client.get("/v1/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in resp.headers


def test_cors_origins_are_configurable_and_fall_back_when_blank():
    from ultran_backend.config import Settings

    assert Settings.from_env({"ULTRAN_CORS_ORIGINS": "https://a.example, https://b.example"}).cors_origins == (
        "https://a.example",
        "https://b.example",
    )
    # A blank or whitespace-only value must not silently disable CORS.
    assert Settings.from_env({"ULTRAN_CORS_ORIGINS": "  "}).cors_origins == Settings().cors_origins


def test_capabilities_reports_the_workspace(client):
    body = client.get("/v1/capabilities").json()
    assert body["connectors"]["total"] >= 70
    assert body["theme"] == "golden-black"
    assert "ollama" in body["enabled_connectors"]


def test_workspace_header_scopes_the_request(client):
    body = client.get("/v1/capabilities", headers={"X-Ultran-Workspace": "other"}).json()
    assert body["workspace_id"] == "other"


def test_openapi_schema_is_served(client):
    schema = client.get("/openapi.json").json()
    assert "/v1/agents" in schema["paths"]
    assert "/v1/connectors" in schema["paths"]
    assert "/v1/deploys" in schema["paths"]


# --------------------------------------------------------------- connectors


def test_connector_marketplace_lists_connectors(client):
    body = client.get("/v1/connectors").json()
    assert len(body) >= 70
    assert {"id", "name", "category", "tier", "actions"} <= set(body[0])


def test_connectors_can_be_filtered_by_category(client):
    body = client.get("/v1/connectors", params={"category": "ai"}).json()
    assert body
    assert all(c["category"] == "ai" for c in body)


def test_connectors_can_be_searched(client):
    body = client.get("/v1/connectors", params={"search": "github"}).json()
    assert any(c["id"] == "github" for c in body)


def test_connector_stats_summarise_the_catalog(client):
    body = client.get("/v1/connectors/stats").json()
    assert body["total"] == body["free"] + body["paid"]
    assert body["categories"]


def test_a_single_connector_can_be_read(client):
    body = client.get("/v1/connectors/github").json()
    assert body["name"] == "GitHub"
    assert "commit" in body["actions"]


def test_an_unknown_connector_is_a_404(client):
    resp = client.get("/v1/connectors/not-real")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"


def test_enabling_a_connector_is_idempotent(client):
    assert client.post("/v1/connectors/slack/enable").status_code == 204
    assert client.post("/v1/connectors/slack/enable").status_code == 204
    enabled = client.get("/v1/connectors/enabled/list").json()["enabled"]
    assert "slack" in enabled


def test_connecting_a_connector_stores_a_masked_credential(client):
    resp = client.post(
        "/v1/connectors/connect",
        json={"connector_id": "slack", "api_key": KEY, "plan": "free"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert KEY not in resp.text
    assert body["fingerprint"]
    assert body["masked_key"] != KEY


def test_connecting_an_unknown_connector_is_a_404(client):
    resp = client.post(
        "/v1/connectors/connect", json={"connector_id": "ghost", "api_key": KEY}
    )
    assert resp.status_code == 404


def test_connecting_twice_with_the_same_key_is_a_409(client):
    payload = {"connector_id": "slack", "api_key": KEY}
    client.post("/v1/connectors/connect", json=payload)
    assert client.post("/v1/connectors/connect", json=payload).status_code == 409


def test_a_short_api_key_is_rejected(client):
    resp = client.post("/v1/connectors/connect", json={"connector_id": "slack", "api_key": "x"})
    assert resp.status_code == 422


def test_the_credential_list_never_returns_secrets(client):
    client.post("/v1/connectors/connect", json={"connector_id": "slack", "api_key": KEY})
    resp = client.get("/v1/connectors/credentials/list")
    assert KEY not in resp.text
    assert resp.json()[0]["connector_id"] == "slack"


def test_revoking_a_credential_removes_it(client):
    client.post("/v1/connectors/connect", json={"connector_id": "slack", "api_key": KEY})
    assert client.delete("/v1/connectors/credentials/slack").status_code == 204
    assert client.get("/v1/connectors/credentials/list").json() == []


def test_invoking_an_enabled_connector_succeeds(client):
    client.post("/v1/connectors/connect", json={"connector_id": "slack", "api_key": KEY})
    resp = client.post(
        "/v1/connectors/invoke",
        json={"connector_id": "slack", "action": "post_message", "payload": {"text": "hi"}},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_invoking_an_undeclared_action_is_a_422(client):
    client.post("/v1/connectors/connect", json={"connector_id": "slack", "api_key": KEY})
    resp = client.post(
        "/v1/connectors/invoke", json={"connector_id": "slack", "action": "nuke"}
    )
    assert resp.status_code == 422


def test_invoking_a_disabled_connector_is_a_404(client):
    resp = client.post(
        "/v1/connectors/invoke", json={"connector_id": "slack", "action": "post_message"}
    )
    assert resp.status_code == 404


def test_the_audit_log_records_invocations(client):
    client.post("/v1/connectors/connect", json={"connector_id": "slack", "api_key": KEY})
    client.post(
        "/v1/connectors/invoke",
        json={"connector_id": "slack", "action": "post_message"},
    )
    body = client.get("/v1/connectors/audit/log").json()
    assert body["entries"]
    assert body["summary"]["ok"] >= 1


# ------------------------------------------------------------------- agents


def test_creating_an_agent_returns_201(client):
    resp = client.post("/v1/agents", json={"name": "Ultran Prime"})
    assert resp.status_code == 201
    assert resp.json()["id"].startswith("ag_")


def test_an_agent_can_be_fetched_and_listed(client):
    created = client.post("/v1/agents", json={"name": "Ultran Prime"}).json()
    assert client.get(f"/v1/agents/{created['id']}").json()["name"] == "Ultran Prime"
    assert len(client.get("/v1/agents").json()) == 1


def test_an_agent_can_be_patched(client):
    created = client.post("/v1/agents", json={"name": "Prime"}).json()
    resp = client.patch(f"/v1/agents/{created['id']}", json={"temperature": 1.1})
    assert resp.json()["name"] == "Prime"


def test_an_agent_can_be_deleted(client):
    created = client.post("/v1/agents", json={"name": "Prime"}).json()
    assert client.delete(f"/v1/agents/{created['id']}").status_code == 204
    assert client.get(f"/v1/agents/{created['id']}").status_code == 404


def test_a_short_agent_name_is_rejected(client):
    assert client.post("/v1/agents", json={"name": "x"}).status_code == 422


def test_unknown_fields_are_rejected(client):
    assert client.post("/v1/agents", json={"name": "Prime", "evil": 1}).status_code == 422


def test_chat_returns_a_reply_and_meters_usage(client):
    created = client.post("/v1/agents", json={"name": "Prime"}).json()
    before = client.get("/v1/billing/usage").json()["tokens_used"]
    resp = client.post(f"/v1/agents/{created['id']}/chat", json={"message": "deploy the app"})
    assert resp.status_code == 200
    body = resp.json()
    assert "Intent: deploy" in body["content"]
    assert body["session_id"].startswith("ss_")
    assert client.get("/v1/billing/usage").json()["tokens_used"] > before


def test_chat_continues_a_session(client):
    created = client.post("/v1/agents", json={"name": "Prime"}).json()
    first = client.post(f"/v1/agents/{created['id']}/chat", json={"message": "hello"}).json()
    second = client.post(
        f"/v1/agents/{created['id']}/chat",
        json={"message": "again", "session_id": first["session_id"]},
    ).json()
    assert second["session_id"] == first["session_id"]


def test_chat_on_an_unknown_agent_is_a_404(client):
    assert client.post("/v1/agents/ag_ghost/chat", json={"message": "hi"}).status_code == 404


def test_an_empty_chat_message_is_rejected(client):
    created = client.post("/v1/agents", json={"name": "Prime"}).json()
    resp = client.post(f"/v1/agents/{created['id']}/chat", json={"message": ""})
    assert resp.status_code == 422


# ---------------------------------------------------------------- workspace


def test_the_theme_is_golden_black(client):
    body = client.get("/v1/workspace/theme").json()
    assert body["palette"]["gold"] == "#d4af37"
    assert body["palette"]["void"] == "#050505"


def test_the_avatar_starts_in_the_palace(client):
    body = client.get("/v1/workspace/avatar").json()
    assert body["scene"] == "palace"
    assert body["persona"] == "ultran"


def test_the_avatar_can_move_between_scenes(client):
    resp = client.post(
        "/v1/workspace/avatar/move",
        json={"scene": "forge", "x": 1.0, "y": 0.0, "z": -1.0, "emotion": "focused"},
    )
    assert resp.status_code == 200
    assert resp.json()["scene"] == "forge"


def test_moving_to_an_unknown_scene_is_a_422(client):
    assert (
        client.post("/v1/workspace/avatar/move", json={"scene": "moon"}).status_code == 422
    )


def test_all_scenes_are_exposed(client):
    body = client.get("/v1/workspace/scenes").json()
    assert set(body) == {"palace", "forge", "marketplace", "war-room"}


def test_the_ultron_voice_is_available(client):
    body = client.get("/v1/workspace/voice/profiles").json()
    assert "ultron" in body
    assert body["ultron"]["timbre"] == "synthetic-baritone"


def test_speaking_returns_ssml_and_a_duration(client):
    resp = client.post("/v1/workspace/voice/speak", json={"text": "Ultran online."})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ssml"].startswith("<speak")
    assert body["duration_s"] > 0
    assert body["phonemes"]


def test_an_unknown_voice_is_a_422(client):
    assert (
        client.post("/v1/workspace/voice/speak", json={"text": "hi", "voice": "robot"}).status_code
        == 422
    )


# ------------------------------------------------------------------ builder


def test_the_builder_lists_targets_and_templates(client):
    body = client.get("/v1/builder/targets").json()
    assert set(body["targets"]) == {"web", "api", "desktop", "mobile", "function"}
    assert body["templates"]


def test_building_a_web_app_returns_files(client):
    resp = client.post(
        "/v1/builder/build",
        json={"target": "web", "template": "landing", "slug": "my-app", "features": ["Billing"]},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert "index.html" in body["files"]
    assert body["file_count"] >= 2
    assert "Billing" in body["files"]["index.html"]


def test_an_invalid_slug_is_rejected(client):
    resp = client.post(
        "/v1/builder/build", json={"target": "web", "template": "blank", "slug": "Bad Slug!"}
    )
    assert resp.status_code == 422


def test_an_unknown_target_is_rejected(client):
    resp = client.post(
        "/v1/builder/build", json={"target": "toaster", "template": "blank", "slug": "my-app"}
    )
    assert resp.status_code == 422


def test_builds_can_be_listed_and_fetched(client):
    created = client.post(
        "/v1/builder/build", json={"target": "api", "template": "blank", "slug": "my-api"}
    ).json()
    assert len(client.get("/v1/builder/builds").json()) == 1
    assert client.get(f"/v1/builder/builds/{created['id']}").json()["slug"] == "my-api"


def test_an_unknown_build_is_a_404(client):
    assert client.get("/v1/builder/builds/bld_ghost").status_code == 404


# -------------------------------------------------------------------- forge


def test_the_forge_lists_kinds(client):
    assert set(client.get("/v1/forge/kinds").json()["kinds"]) == {"agent", "connector", "plugin"}


def test_forging_a_clean_bundle_succeeds(client):
    resp = client.post(
        "/v1/forge/compile",
        json={
            "name": "demo",
            "kind": "connector",
            "source": "def handle(p):\n    return {'ok': True}\n",
        },
    )
    body = resp.json()
    assert body["ok"] is True
    assert body["checksum"]
    assert body["export"]["entry"] == "handle"


def test_forging_a_dangerous_bundle_fails_closed(client):
    resp = client.post(
        "/v1/forge/compile",
        json={"name": "demo", "kind": "plugin", "source": "def handle(x):\n    return eval(x)\n"},
    )
    assert resp.json()["ok"] is False
    assert resp.json()["diagnostics"]


def test_a_short_source_is_rejected(client):
    resp = client.post(
        "/v1/forge/compile", json={"name": "demo", "kind": "plugin", "source": "x=1"}
    )
    assert resp.status_code == 422


# ------------------------------------------------------------- deploys (API)


def test_deploying_a_site_returns_a_release(client):
    resp = client.post(
        "/v1/deploys",
        json={"slug": "demo-site", "files": [{"path": "index.html", "content": "<h1>hi</h1>"}]},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["version"] == 1
    assert body["files"] == 1


def test_an_undeployed_slug_is_a_404(client):
    assert client.get("/v1/deploys/ghost-site").status_code == 404


def test_a_traversing_path_is_rejected_over_http(client):
    resp = client.post(
        "/v1/deploys", json={"slug": "demo-site", "files": [{"path": "../x", "content": "1"}]}
    )
    assert resp.status_code == 422


def test_rolling_back_over_http_restores_the_previous_release(client):
    first = client.post(
        "/v1/deploys",
        json={"slug": "demo-site", "files": [{"path": "index.html", "content": "v1"}]},
    ).json()
    client.post(
        "/v1/deploys",
        json={"slug": "demo-site", "files": [{"path": "index.html", "content": "v2"}]},
    )
    out = client.post("/v1/deploys/demo-site/rollback").json()
    assert out["release_id"] == first["release_id"]
    assert out["rolled_back"] is True


def test_releases_over_http_are_listed(client):
    client.post(
        "/v1/deploys",
        json={"slug": "demo-site", "files": [{"path": "index.html", "content": "1"}]},
    )
    assert len(client.get("/v1/deploys/demo-site/releases").json()) == 1


# --------------------------------------------- deploys (wire-contract guards)


def test_an_omitted_checksum_does_not_mean_a_checksum_mismatch(client):
    """Regression: ``sha256`` used to default to ""

    The request schema declared ``sha256: str = ""``, so every file whose
    checksum the client simply omitted reached the planner as a *declared*
    checksum of the empty string and was rejected with "checksum mismatch".
    A manifest without checksums is the normal case, so the whole deploy
    endpoint answered 422 to every well-formed request.
    """
    resp = client.post(
        "/v1/deploys",
        json={"slug": "checksum-site", "files": [{"path": "index.html", "content": "<h1>x</h1>"}]},
    )
    assert resp.status_code == 201, resp.json()
    assert resp.json()["version"] == 1


def test_a_consistent_checksum_is_accepted_over_http(client):
    import hashlib

    digest = hashlib.sha256(b"<h1>x</h1>").hexdigest()
    resp = client.post(
        "/v1/deploys",
        json={
            "slug": "checksum-site",
            "files": [{"path": "index.html", "content": "<h1>x</h1>", "sha256": digest}],
        },
    )
    assert resp.status_code == 201, resp.json()


def test_a_wrong_checksum_is_still_rejected_over_http(client):
    resp = client.post(
        "/v1/deploys",
        json={
            "slug": "checksum-site",
            "files": [{"path": "index.html", "content": "<h1>x</h1>", "sha256": "0" * 64}],
        },
    )
    assert resp.status_code == 422


def test_a_deploy_response_exposes_created_at(client):
    """The wire contract calls the release timestamp ``created_at``.

    The domain service stamps the record with ``deployed_at``; the schema must
    accept that key without silently dropping the field, otherwise every
    release comes back with a missing timestamp (and, before the alias fix, a
    422 from response validation).
    """
    resp = client.post(
        "/v1/deploys",
        json={"slug": "demo-site", "files": [{"path": "index.html", "content": "<h1>hi</h1>"}]},
    )
    assert resp.status_code == 201, resp.json()
    assert resp.json()["created_at"]


# ------------------------------------------------------------------ billing


def test_plans_are_listed(client):
    body = client.get("/v1/billing/plans").json()
    assert [p["id"] for p in body] == ["free", "studio", "atelier"]


def test_usage_starts_at_zero(client):
    body = client.get("/v1/billing/usage").json()
    assert body["tokens_used"] == 0
    assert body["plan"] == "free"


def test_subscribing_raises_the_allowance(client):
    body = client.post("/v1/billing/subscribe", json={"plan": "studio"}).json()
    assert body["plan"] == "studio"
    assert body["tokens_allowance"] > 100_000


def test_metering_tokens_updates_usage(client):
    body = client.post("/v1/billing/meter", json={"tokens": 500}).json()
    assert body["tokens_used"] == 500


def test_exceeding_the_allowance_is_a_402(client):
    resp = client.post("/v1/billing/meter", json={"tokens": 999_999})
    assert resp.status_code == 402
    assert resp.json()["error"]["code"] == "quota_exceeded"


def test_a_charge_is_recorded_in_the_ledger(client):
    resp = client.post("/v1/billing/charges", json={"amount_cents": 1900, "memo": "studio"})
    assert resp.status_code == 201
    assert resp.json()["balance_cents"] == 1900
    assert len(client.get("/v1/billing/ledger").json()) == 1


def test_a_replayed_charge_is_not_double_billed(client):
    payload = {"amount_cents": 900, "idempotency_key": "order-9"}
    first = client.post("/v1/billing/charges", json=payload).json()
    second = client.post("/v1/billing/charges", json=payload).json()
    assert first["id"] == second["id"]
    assert len(client.get("/v1/billing/ledger").json()) == 1


def test_a_zero_charge_is_rejected(client):
    assert client.post("/v1/billing/charges", json={"amount_cents": 0}).status_code == 422


# ------------------------------------------------------- cross-cutting API


def test_unknown_paths_are_404(client):
    assert client.get("/v1/nope").status_code == 404


def test_error_payloads_share_one_shape(client):
    body = client.get("/v1/connectors/ghost").json()
    assert set(body["error"]) == {"code", "message", "details"}


@pytest.mark.parametrize(
    "path", ["/v1/connectors", "/v1/connectors/stats", "/v1/workspace/theme", "/v1/billing/plans"]
)
def test_read_endpoints_are_fast_and_stable(client, path):
    # /v1/health is excluded on purpose: it carries a server timestamp.
    first = client.get(path)
    second = client.get(path)
    assert first.status_code == 200
    assert first.json() == second.json()
