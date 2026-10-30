/**
 * The Ultran mark as inline SVG. The polygons are the same 108-unit geometry
 * that android/tools/generate_assets.py uses for the launcher icon, so the app
 * and the home-screen icon cannot drift apart.
 */

type Poly = ReadonlyArray<readonly [number, number]>;

const SHELL: Poly = [[54, 22], [75, 31], [81, 53], [70, 76], [54, 87], [38, 76], [27, 53], [33, 31]];
const FACET_LIGHT: Poly = [[54, 22], [75, 31], [54, 44], [33, 31]];
const FACET_DEEP: Poly = [[81, 53], [70, 76], [54, 87], [54, 60]];
const FACE: Poly = [[54, 36], [68, 41], [71, 54], [63, 69], [54, 74], [45, 69], [37, 54], [40, 41]];
const EYE_L: Poly = [[40, 49], [51, 53], [51, 58], [41, 55]];
const EYE_R: Poly = [[57, 53], [68, 49], [67, 55], [57, 58]];
const GRILLE_A: Poly = [[48, 65], [60, 65], [60, 67], [48, 67]];
const GRILLE_B: Poly = [[49, 69], [59, 69], [59, 70.6], [49, 70.6]];
const CREST: Poly = [[53, 22], [55, 22], [55, 35], [53, 35]];

const points = (poly: Poly): string => poly.map(([x, y]) => `${x},${y}`).join(" ");

/** Returns SVG markup. `eyes` lets the caller recolour the sensors per scene. */
export function markSvg(size = 24, eyes = "var(--eye, #f5d76e)"): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 16 68 76" width="${size}" ` +
    `height="${Math.round((size * 76) / 68)}" aria-hidden="true" focusable="false">` +
    `<polygon points="${points(SHELL)}" fill="#d4af37"/>` +
    `<polygon points="${points(FACET_LIGHT)}" fill="#f5d76e"/>` +
    `<polygon points="${points(FACET_DEEP)}" fill="#8a6d1f"/>` +
    `<polygon points="${points(FACE)}" fill="#131317"/>` +
    `<polygon class="eye" points="${points(EYE_L)}" fill="${eyes}"/>` +
    `<polygon class="eye" points="${points(EYE_R)}" fill="${eyes}"/>` +
    `<polygon points="${points(GRILLE_A)}" fill="#8a6d1f"/>` +
    `<polygon points="${points(GRILLE_B)}" fill="#8a6d1f"/>` +
    `<polygon points="${points(CREST)}" fill="#0b0b0d"/>` +
    `</svg>`
  );
}

/** A data: URL for the favicon, so the page needs no extra asset. */
export function markDataUrl(): string {
  return `data:image/svg+xml,${encodeURIComponent(markSvg(64, "#f5d76e"))}`;
}
