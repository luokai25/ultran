"""Credential vault tests: masking, fingerprinting, no-echo guarantees."""

from __future__ import annotations

import pytest

from ultran_backend.connectors.credentials import (
    MAX_SECRET_LEN,
    MIN_SECRET_LEN,
    CredentialVault,
    fingerprint,
    mask_secret,
    new_workspace_token,
)
from ultran_backend.errors import Conflict, NotFound, ValidationFailed

KEY = "sk-live-abcdefghijklmnop-1234"


# --------------------------------------------------------------- masking


def test_mask_hides_the_middle():
    masked = mask_secret(KEY)
    assert masked.startswith("sk-l")
    assert masked.endswith("1234")
    assert "abcdefgh" not in masked


def test_mask_never_leaks_a_short_secret():
    assert mask_secret("short") == "*****"
    assert mask_secret("abc") == "****"


def test_mask_keeps_at_most_eight_visible_chars_out_of_a_long_key():
    masked = mask_secret(KEY)
    visible = [c for c in masked if c != "*"]
    assert len(visible) <= 8


@pytest.mark.parametrize("secret", ["aaaaaaaa", "a" * 40, "prefix-9f8e7d6c"])
def test_mask_is_never_the_plaintext(secret):
    assert mask_secret(secret) != secret


# ---------------------------------------------------------- fingerprint


def test_fingerprint_is_stable_and_short():
    assert fingerprint(KEY) == fingerprint(KEY)
    assert len(fingerprint(KEY)) == 16


def test_fingerprint_differs_for_different_keys():
    assert fingerprint(KEY) != fingerprint(KEY + "x")


def test_fingerprint_does_not_contain_the_secret():
    fp = fingerprint(KEY)
    assert "abcdef" not in fp
    assert fp.isalnum()


# ----------------------------------------------------------------- vault


def test_put_stores_and_returns_masked():
    v = CredentialVault()
    cred = v.put("ws", "github", KEY)
    assert cred.masked_key != KEY
    assert cred.connector_id == "github"
    assert cred.plan == "free"
    assert cred.uses == 0


def test_put_rejects_short_keys():
    v = CredentialVault()
    with pytest.raises(ValidationFailed, match="too short"):
        v.put("ws", "github", "a" * (MIN_SECRET_LEN - 1))


def test_put_rejects_blank_keys():
    v = CredentialVault()
    with pytest.raises(ValidationFailed):
        v.put("ws", "github", "        ")


def test_put_rejects_oversized_keys():
    v = CredentialVault()
    with pytest.raises(ValidationFailed, match="too long"):
        v.put("ws", "github", "a" * (MAX_SECRET_LEN + 1))


def test_put_rejects_unknown_plan():
    v = CredentialVault()
    with pytest.raises(ValidationFailed, match="plan"):
        v.put("ws", "github", KEY, plan="enterprise")


def test_put_rejects_blank_label():
    v = CredentialVault()
    with pytest.raises(ValidationFailed, match="label"):
        v.put("ws", "github", KEY, label="  ")


def test_identical_credential_is_rejected():
    v = CredentialVault()
    v.put("ws", "github", KEY)
    with pytest.raises(Conflict, match="identical"):
        v.put("ws", "github", KEY)


def test_different_key_overwrites_the_slot():
    v = CredentialVault()
    v.put("ws", "github", KEY)
    second = v.put("ws", "github", KEY + "-rotated")
    assert v.count("ws") == 1
    assert v.get("ws", "github").fingerprint == second.fingerprint


def test_labels_are_independent_slots():
    v = CredentialVault()
    v.put("ws", "github", KEY, label="work")
    v.put("ws", "github", KEY + "2", label="personal")
    assert v.count("ws") == 2
    assert len(v.list("ws")) == 2


def test_get_missing_credential_raises():
    v = CredentialVault()
    with pytest.raises(NotFound):
        v.get("ws", "github")


def test_get_wrong_label_raises():
    v = CredentialVault()
    v.put("ws", "github", KEY, label="work")
    with pytest.raises(NotFound):
        v.get("ws", "github", "default")


def test_has_reports_presence():
    v = CredentialVault()
    assert v.has("ws", "github") is False
    v.put("ws", "github", KEY)
    assert v.has("ws", "github") is True


def test_workspaces_are_isolated():
    v = CredentialVault()
    v.put("ws-a", "github", KEY)
    assert v.has("ws-b", "github") is False
    with pytest.raises(NotFound):
        v.get("ws-b", "github")


def test_same_key_can_live_in_two_workspaces():
    v = CredentialVault()
    v.put("ws-a", "github", KEY)
    v.put("ws-b", "github", KEY)  # no Conflict: different workspace bucket
    assert v.count("ws-a") == 1
    assert v.count("ws-b") == 1


def test_list_is_sorted_and_stable():
    v = CredentialVault()
    v.put("ws", "slack", KEY + "1")
    v.put("ws", "github", KEY + "2")
    ids = [c.connector_id for c in v.list("ws")]
    assert ids == ["github", "slack"]


def test_revoke_removes_the_credential():
    v = CredentialVault()
    v.put("ws", "github", KEY)
    v.revoke("ws", "github")
    assert v.has("ws", "github") is False
    with pytest.raises(NotFound):
        v.revoke("ws", "github")


def test_revoke_unknown_workspace_raises():
    v = CredentialVault()
    with pytest.raises(NotFound):
        v.revoke("ghost-ws", "github")


def test_rotate_changes_the_secret_and_keeps_the_plan():
    v = CredentialVault()
    v.put("ws", "github", KEY, plan="paid")
    rotated = v.rotate("ws", "github", KEY + "-new")
    assert rotated.plan == "paid"
    assert rotated.fingerprint == fingerprint(KEY + "-new")


def test_rotate_on_missing_credential_raises():
    v = CredentialVault()
    with pytest.raises(NotFound):
        v.rotate("ws", "github", KEY)


def test_touch_tracks_usage():
    v = CredentialVault()
    v.put("ws", "github", KEY)
    v.get("ws", "github").touch()
    cred = v.get("ws", "github")
    assert cred.uses == 1
    assert cred.last_used_at is not None


def test_public_payload_never_includes_the_secret():
    v = CredentialVault()
    v.put("ws", "github", KEY)
    payload = v.get("ws", "github").public()
    assert KEY not in str(payload)
    assert set(payload) >= {"connector_id", "label", "plan", "masked_key", "fingerprint"}


def test_reveal_is_available_for_the_sandbox_only():
    v = CredentialVault()
    v.put("ws", "github", KEY)
    assert v.get("ws", "github").reveal() == KEY


def test_wipe_clears_a_workspace():
    v = CredentialVault()
    v.put("ws", "github", KEY)
    v.put("ws", "slack", KEY + "x")
    assert v.wipe("ws") == 2
    assert v.count("ws") == 0


def test_workspace_token_is_prefixed_and_unique():
    a, b = new_workspace_token(), new_workspace_token()
    assert a.startswith("ult_")
    assert a != b
    assert len(a) > 20
