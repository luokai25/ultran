#!/usr/bin/env python3
"""Generate the Ultran launcher icons and splash screens.

The Android project is committed as text. Its raster assets are generated here
instead of being checked in, so the repository carries no opaque binaries and
the artwork is reviewable as code.

Run from `apps/phone/android`:

    python3 tools/generate_assets.py

Requires Pillow (`pip install pillow`). CI installs it before the Gradle build.
"""

from __future__ import annotations

import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - CI installs Pillow explicitly
    sys.exit("Pillow is required: pip install pillow")

VOID = (5, 5, 5)
OBSIDIAN = (11, 11, 13)
GOLD = (212, 175, 55)
GOLD_BRIGHT = (245, 215, 110)
GOLD_DEEP = (138, 109, 31)

RES = "app/src/main/res"

DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

SPLASHES = {
    "drawable/splash.png": (480, 800),
    "drawable-port-mdpi/splash.png": (320, 480),
    "drawable-port-hdpi/splash.png": (480, 800),
    "drawable-port-xhdpi/splash.png": (720, 1280),
    "drawable-port-xxhdpi/splash.png": (960, 1600),
    "drawable-port-xxxhdpi/splash.png": (1280, 1920),
    "drawable-land-mdpi/splash.png": (480, 320),
    "drawable-land-hdpi/splash.png": (800, 480),
    "drawable-land-xhdpi/splash.png": (1280, 720),
    "drawable-land-xxhdpi/splash.png": (1600, 960),
    "drawable-land-xxxhdpi/splash.png": (1920, 1280),
}


def mark(size: int, background: tuple[int, int, int], pad_ratio: float = 0.30) -> Image.Image:
    """A faceted gold diamond on a dark field - the Ultran mark."""
    img = Image.new("RGB", (size, size), background)
    draw = ImageDraw.Draw(img)
    centre = size / 2
    radius = size * (0.5 - pad_ratio)

    draw.polygon(
        [
            (centre, centre - radius),
            (centre + radius, centre),
            (centre, centre + radius),
            (centre - radius, centre),
        ],
        fill=GOLD,
    )

    inner = radius * 0.52
    draw.polygon(
        [
            (centre, centre - inner),
            (centre + inner, centre),
            (centre, centre + inner),
            (centre - inner, centre),
        ],
        fill=GOLD_DEEP,
    )

    draw.polygon(
        [
            (centre, centre - radius),
            (centre + radius * 0.42, centre - radius * 0.30),
            (centre, centre - radius * 0.10),
        ],
        fill=GOLD_BRIGHT,
    )
    return img


def splash(width: int, height: int) -> Image.Image:
    img = Image.new("RGB", (width, height), VOID)
    draw = ImageDraw.Draw(img)
    cx, cy = width / 2, height / 2

    # A soft glow, built from concentric ellipses so it needs no gradient support.
    for step in range(28, 0, -1):
        t = step / 28
        radius = min(width, height) * 0.42 * t
        shade = (
            int(5 + 18 * (1 - t)),
            int(5 + 14 * (1 - t)),
            int(5 + 6 * (1 - t)),
        )
        draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=shade)

    logo = mark(int(min(width, height) * 0.30), VOID, 0.0)
    img.paste(logo, (int(cx - logo.width / 2), int(cy - logo.height / 2)))
    return img


def transparent_foreground(size: int) -> Image.Image:
    """Adaptive-icon foreground: the mark on transparency, inside the safe zone."""
    logo = mark(int(size * 0.62), OBSIDIAN, 0.0).convert("RGBA")
    pixels = logo.load()
    for y in range(logo.height):
        for x in range(logo.width):
            r, g, b, _ = pixels[x, y]
            if abs(r - OBSIDIAN[0]) < 6 and abs(g - OBSIDIAN[1]) < 6 and abs(b - OBSIDIAN[2]) < 6:
                pixels[x, y] = (0, 0, 0, 0)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(logo, ((size - logo.width) // 2, (size - logo.height) // 2), logo)
    return canvas


def main() -> None:
    if not os.path.isdir(RES):
        sys.exit(f"run this from apps/phone/android (no {RES} here)")

    for density, px in DENSITIES.items():
        out = os.path.join(RES, f"mipmap-{density}")
        os.makedirs(out, exist_ok=True)
        mark(px, OBSIDIAN).save(os.path.join(out, "ic_launcher.png"), optimize=True)
        mark(px, OBSIDIAN).save(os.path.join(out, "ic_launcher_round.png"), optimize=True)
        transparent_foreground(px).save(
            os.path.join(out, "ic_launcher_foreground.png"), optimize=True
        )

    for path, (width, height) in SPLASHES.items():
        full = os.path.join(RES, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        # A flat dark field with a small mark quantises to a tiny palette PNG.
        splash(width, height).quantize(colors=32, method=Image.MEDIANCUT).save(
            full, optimize=True
        )

    total = 0
    for root, _, files in os.walk(RES):
        for name in files:
            total += os.path.getsize(os.path.join(root, name))
    print(f"generated launcher icons and {len(SPLASHES)} splash screens ({total} bytes)")


if __name__ == "__main__":
    main()
