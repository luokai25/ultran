"""The golden-black design system, shared by the API and the web workspace.

Tokens live here (not only in CSS) so the 3D scene, the voice phonemiser and the
REST payloads all describe the same palette.
"""

from __future__ import annotations

from typing import Any

PALETTE: dict[str, str] = {
    "void": "#050505",
    "obsidian": "#0b0b0d",
    "carbon": "#131317",
    "graphite": "#1b1b21",
    "hairline": "#2a2a33",
    "gold": "#d4af37",
    "gold_bright": "#f5d76e",
    "gold_deep": "#8a6d1f",
    "gold_glow": "rgba(212, 175, 55, 0.35)",
    "ember": "#ff8a3d",
    "danger": "#e5484d",
    "ok": "#3dd68c",
    "ink": "#f4f1e8",
    "muted": "#8d8778",
}

SCENES: dict[str, dict[str, Any]] = {
    "palace": {
        "label": "Obsidian Palace",
        "floor": "#0b0b0d",
        "accent": "#d4af37",
        "fog": "#050505",
        "spawn": (0.0, 0.0, 0.0),
        "description": "The main hall. Ultran briefs you on what the workspace can reach.",
    },
    "forge": {
        "label": "The Forge",
        "floor": "#120d07",
        "accent": "#ff8a3d",
        "fog": "#0a0603",
        "spawn": (-2.0, 0.0, 1.5),
        "description": "Where connectors and agents get compiled and signed.",
    },
    "marketplace": {
        "label": "Marketplace Vault",
        "floor": "#0a0a0e",
        "accent": "#f5d76e",
        "fog": "#050507",
        "spawn": (2.0, 0.0, -1.0),
        "description": "Browse, price and enable every connector you own.",
    },
    "war-room": {
        "label": "War Room",
        "floor": "#0d0a0a",
        "accent": "#e5484d",
        "fog": "#070404",
        "spawn": (0.0, 0.0, 2.5),
        "description": "Revenue, deployments and incidents on one wall.",
    },
}

EMOTIONS: dict[str, dict[str, Any]] = {
    "calm": {"tint": "#d4af37", "pulse_hz": 0.4, "intensity": 0.55},
    "focused": {"tint": "#f5d76e", "pulse_hz": 1.1, "intensity": 0.75},
    "alert": {"tint": "#ff8a3d", "pulse_hz": 2.2, "intensity": 0.9},
    "triumphant": {"tint": "#3dd68c", "pulse_hz": 1.6, "intensity": 1.0},
}


def theme() -> dict[str, Any]:
    return {
        "palette": dict(PALETTE),
        "scenes": {k: {**v, "spawn": list(v["spawn"])} for k, v in SCENES.items()},
        "emotions": EMOTIONS,
    }
