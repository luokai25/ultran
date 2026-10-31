/**
 * Ultran's updated monogram mark. Keep the 108-unit geometry aligned with
 * android/tools/generate_assets.py so the app and launcher stay identical.
 */
type Poly = ReadonlyArray<readonly [number, number]>;
const SHELL: Poly = [[54,14],[83,29],[83,70],[54,94],[25,70],[25,29]];
const INNER: Poly = [[54,24],[73,35],[73,65],[54,81],[35,65],[35,35]];
const MONOGRAM: Poly = [[39,38],[48,38],[48,58],[51,63],[57,63],[60,58],[60,38],[69,38],[69,60],[63,71],[45,71],[39,60]];
const CREST: Poly = [[54,23],[60,31],[54,35],[48,31]];
const points = (poly: Poly): string => poly.map(([x,y]) => `${x},${y}`).join(" ");
export function markSvg(size = 24, eyes = "var(--eye, #f0d58a)"): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="14 10 80 88" width="${size}" height="${Math.round(size * 1.1)}" aria-hidden="true" focusable="false">` +
    `<polygon points="${points(SHELL)}" fill="#cda94d"/>` +
    `<polygon points="${points(INNER)}" fill="#0b0d0f"/>` +
    `<polygon points="${points(MONOGRAM)}" fill="#f0d58a"/>` +
    `<polygon points="${points(CREST)}" fill="${eyes}"/>` +
    `</svg>`
  );
}
export function markDataUrl(): string {
  return `data:image/svg+xml,${encodeURIComponent(markSvg(64, "#f0d58a"))}`;
}
