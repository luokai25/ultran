"""Ultran avatar: the 3D stage state plus the Ultron-style voice synthesiser.

The avatar is server-authoritative. The browser sends intents ("move to the
forge", "look alert") and this service returns the resolved state the renderer
should converge on - so a second device, or a reconnect, lands in the same
place instead of guessing.

``VoiceService`` does not call a TTS vendor. It phonemises locally into SSML plus
a viseme timeline, which is exactly what a Web Speech / ElevenLabs adapter needs
as input, and what the 3D mouth rig needs to animate in sync.
"""

from __future__ import annotations

import re
from typing import Any

from .errors import ValidationFailed
from .theme import EMOTIONS, PALETTE, SCENES

VOWELS = set("aeiouy")
_VOICE_PROFILES: dict[str, dict[str, Any]] = {
    "ultron": {"pitch": -2.0, "speed": 0.95, "timbre": "synthetic-baritone", "detune": 0.0},
    "narrator": {"pitch": -1.0, "speed": 1.0, "timbre": "warm-neutral", "detune": 0.0},
    "operator": {"pitch": 0.5, "speed": 1.08, "timbre": "clipped-alto", "detune": 0.0},
}


def _syllables(word: str) -> int:
    count, prev = 0, False
    for ch in word.lower():
        is_vowel = ch in VOWELS
        if is_vowel and not prev:
            count += 1
        prev = is_vowel
    if word.lower().endswith("e") and count > 1:
        count -= 1
    return max(1, count)


def phonemise(text: str) -> list[str]:
    """Split into syllable-ish tokens that a mouth rig can step through."""
    tokens: list[str] = []
    for word in re.findall(r"[A-Za-z']+", text or ""):
        for _ in range(_syllables(word)):
            tokens.append(word[:3].lower())
    return tokens


class AvatarService:
    """Tracks one avatar per workspace."""

    def __init__(self) -> None:
        self._state: dict[str, dict[str, Any]] = {}

    def _ensure(self, workspace_id: str) -> dict[str, Any]:
        if workspace_id not in self._state:
            spawn = SCENES["palace"]["spawn"]
            self._state[workspace_id] = {
                "persona": "ultran",
                "scene": "palace",
                "emotion": "calm",
                "position": (float(spawn[0]), float(spawn[1]), float(spawn[2])),
                "palette": dict(PALETTE),
                "moves": 0,
            }
        return self._state[workspace_id]

    def state(self, workspace_id: str) -> dict[str, Any]:
        return dict(self._ensure(workspace_id))

    def move(
        self,
        workspace_id: str,
        *,
        scene: str,
        x: float = 0.0,
        y: float = 0.0,
        z: float = 0.0,
        emotion: str = "calm",
    ) -> dict[str, Any]:
        if scene not in SCENES:
            raise ValidationFailed(
                "unknown scene", details={"scene": scene, "valid": sorted(SCENES)}
            )
        if emotion not in EMOTIONS:
            raise ValidationFailed(
                "unknown emotion", details={"emotion": emotion, "valid": sorted(EMOTIONS)}
            )
        for axis, value in (("x", x), ("y", y), ("z", z)):
            if not -40.0 <= value <= 40.0:
                raise ValidationFailed(
                    "coordinate out of range", details={"axis": axis, "value": value}
                )
        st = self._ensure(workspace_id)
        st.update(
            scene=scene,
            emotion=emotion,
            position=(float(x), float(y), float(z)),
            moves=st["moves"] + 1,
        )
        return dict(st)

    def set_emotion(self, workspace_id: str, emotion: str) -> dict[str, Any]:
        if emotion not in EMOTIONS:
            raise ValidationFailed("unknown emotion", details={"emotion": emotion})
        st = self._ensure(workspace_id)
        st["emotion"] = emotion
        return dict(st)

    def scene_manifest(self) -> dict[str, Any]:
        return {k: {**v, "spawn": list(v["spawn"])} for k, v in SCENES.items()}


class VoiceService:
    """Ultron-style voice: phoneme timeline + SSML, no network."""

    def render(
        self, text: str, *, voice: str = "ultron", speed: float = 0.95, pitch: float = -2.0
    ) -> dict[str, Any]:
        if not text.strip():
            raise ValidationFailed("text must not be empty")
        if voice not in _VOICE_PROFILES:
            raise ValidationFailed(
                "unknown voice", details={"voice": voice, "valid": sorted(_VOICE_PROFILES)}
            )
        if not 0.5 <= speed <= 2.0:
            raise ValidationFailed("speed must be between 0.5 and 2.0")
        if not -12.0 <= pitch <= 12.0:
            raise ValidationFailed("pitch must be between -12 and 12 semitones")

        profile = _VOICE_PROFILES[voice]
        phonemes = phonemise(text)
        # ~165 ms per syllable at 1.0x is a natural pace for a synthetic baritone
        duration = round(max(0.35, len(phonemes) * 0.165 / speed), 3)
        ssml = (
            '<speak version="1.0" xml:lang="en-US">'
            f'<prosody rate="{speed:.2f}" pitch="{pitch:+.1f}st">'
            f"<voice name=\"ultran-{voice}\">{text}</voice>"
            "</prosody></speak>"
        )
        return {
            "voice": voice,
            "duration_s": duration,
            "syllables": len(phonemes),
            "phonemes": phonemes,
            "ssml": ssml,
            "profile": profile,
            "visemes": [
                {"t": round(i * 0.165 / speed, 3), "token": tok} for i, tok in enumerate(phonemes)
            ],
        }

    def profiles(self) -> dict[str, Any]:
        return dict(_VOICE_PROFILES)
