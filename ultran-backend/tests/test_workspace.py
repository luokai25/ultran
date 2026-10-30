"""Avatar, voice and theme tests."""

from __future__ import annotations

import pytest

from ultran_backend.errors import ValidationFailed
from ultran_backend.theme import EMOTIONS, PALETTE, SCENES, theme
from ultran_backend.workspace import AvatarService, VoiceService, phonemise


# ------------------------------------------------------------------ theme


def test_palette_is_golden_black():
    assert PALETTE["gold"] == "#d4af37"
    assert PALETTE["void"] == "#050505"
    assert PALETTE["gold_bright"] == "#f5d76e"


def test_theme_exposes_scenes_and_emotions():
    t = theme()
    assert set(t) == {"palette", "scenes", "emotions"}
    assert "palace" in t["scenes"]
    assert "calm" in t["emotions"]


def test_all_four_scenes_exist_with_spawn_points():
    assert set(SCENES) == {"palace", "forge", "marketplace", "war-room"}
    for scene in SCENES.values():
        assert len(scene["spawn"]) == 3
        assert scene["description"]


def test_theme_scene_spawn_is_serialisable():
    assert isinstance(theme()["scenes"]["palace"]["spawn"], list)


def test_every_emotion_has_a_tint_and_pulse():
    for name, spec in EMOTIONS.items():
        assert spec["tint"].startswith("#")
        assert spec["pulse_hz"] > 0
        assert 0 < spec["intensity"] <= 1


# ----------------------------------------------------------------- avatar


def test_avatar_starts_in_the_palace():
    st = AvatarService().state("ws")
    assert st["scene"] == "palace"
    assert st["emotion"] == "calm"
    assert st["persona"] == "ultran"
    assert st["moves"] == 0


def test_avatar_state_is_isolated_per_workspace():
    svc = AvatarService()
    svc.move("ws-a", scene="forge")
    assert svc.state("ws-a")["scene"] == "forge"
    assert svc.state("ws-b")["scene"] == "palace"


def test_move_updates_scene_position_and_emotion():
    svc = AvatarService()
    st = svc.move("ws", scene="forge", x=1.5, y=0.0, z=-2.5, emotion="focused")
    assert st["scene"] == "forge"
    assert st["position"] == (1.5, 0.0, -2.5)
    assert st["emotion"] == "focused"
    assert st["moves"] == 1


def test_move_counts_each_move():
    svc = AvatarService()
    svc.move("ws", scene="forge")
    svc.move("ws", scene="marketplace")
    assert svc.state("ws")["moves"] == 2


def test_move_rejects_an_unknown_scene():
    with pytest.raises(ValidationFailed, match="scene"):
        AvatarService().move("ws", scene="moon")


def test_move_rejects_an_unknown_emotion():
    with pytest.raises(ValidationFailed, match="emotion"):
        AvatarService().move("ws", scene="palace", emotion="angry")


@pytest.mark.parametrize("axis", [{"x": 41.0}, {"y": -41.0}, {"z": 99.0}])
def test_move_rejects_out_of_range_coordinates(axis):
    with pytest.raises(ValidationFailed, match="range"):
        AvatarService().move("ws", scene="palace", **axis)


def test_move_accepts_the_boundary_values():
    st = AvatarService().move("ws", scene="palace", x=40.0, z=-40.0)
    assert st["position"] == (40.0, 0.0, -40.0)


def test_set_emotion_changes_only_the_emotion():
    svc = AvatarService()
    st = svc.set_emotion("ws", "alert")
    assert st["emotion"] == "alert"
    assert st["scene"] == "palace"


def test_set_emotion_rejects_unknown():
    with pytest.raises(ValidationFailed):
        AvatarService().set_emotion("ws", "sleepy")


def test_scene_manifest_lists_every_scene():
    manifest = AvatarService().scene_manifest()
    assert set(manifest) == set(SCENES)
    assert isinstance(manifest["forge"]["spawn"], list)


# ------------------------------------------------------------------ voice


def test_phonemise_returns_syllable_tokens():
    # "hello" has two vowel groups; "world" has one.
    assert phonemise("hello world") == ["hel", "hel", "wor"]


def test_phonemise_tracks_one_token_per_vowel_group():
    assert phonemise("ultran") == ["ult", "ult"]
    assert phonemise("a") == ["a"]
    assert phonemise("beautiful") == ["bea", "bea", "bea"]


def test_phonemise_handles_empty_text():
    assert phonemise("") == []


def test_phonemise_ignores_punctuation():
    assert phonemise("hi!!! ...") == ["hi"]


def test_render_returns_ssml_and_a_timeline():
    out = VoiceService().render("Ultran online and listening.")
    assert out["ssml"].startswith("<speak")
    assert out["voice"] == "ultron"
    assert out["syllables"] > 0
    assert len(out["visemes"]) == out["syllables"]
    assert out["duration_s"] > 0


def test_render_timeline_is_monotonic():
    out = VoiceService().render("a longer line of dialogue for the timeline")
    times = [v["t"] for v in out["visemes"]]
    assert times == sorted(times)


def test_faster_speech_is_shorter():
    svc = VoiceService()
    slow = svc.render("the same words", speed=0.75)["duration_s"]
    fast = svc.render("the same words", speed=1.5)["duration_s"]
    assert fast < slow


def test_ultron_profile_is_a_low_baritone():
    out = VoiceService().render("hello")
    assert out["profile"]["timbre"] == "synthetic-baritone"
    assert out["profile"]["pitch"] < 0


@pytest.mark.parametrize("voice", ["ultron", "narrator", "operator"])
def test_every_voice_renders(voice):
    assert VoiceService().render("test line", voice=voice)["voice"] == voice


def test_render_rejects_an_unknown_voice():
    with pytest.raises(ValidationFailed, match="voice"):
        VoiceService().render("hi", voice="robot")


def test_render_rejects_empty_text():
    with pytest.raises(ValidationFailed, match="text"):
        VoiceService().render("   ")


@pytest.mark.parametrize("speed", [0.4, 2.1])
def test_render_rejects_out_of_range_speed(speed):
    with pytest.raises(ValidationFailed, match="speed"):
        VoiceService().render("hi", speed=speed)


@pytest.mark.parametrize("pitch", [-13.0, 13.0])
def test_render_rejects_out_of_range_pitch(pitch):
    with pytest.raises(ValidationFailed, match="pitch"):
        VoiceService().render("hi", pitch=pitch)


def test_profiles_lists_all_three_voices():
    assert set(VoiceService().profiles()) == {"ultron", "narrator", "operator"}


def test_ssml_carries_the_pitch_and_rate():
    out = VoiceService().render("hi", speed=1.25, pitch=-4.0)
    assert 'rate="1.25"' in out["ssml"]
    assert 'pitch="-4.0st"' in out["ssml"]
