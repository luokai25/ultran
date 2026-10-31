/**
 * Ultran's shield monogram. The geometry and palette match
 * android/tools/generate_assets.py so the app mark and launcher stay aligned.
 */
type Point = readonly [number, number];
type Polygon = readonly Point[];

const SHELL: Polygon = [[54,14],[83,29],[83,70],[54,94],[25,70],[25,29]];
const INNER: Polygon = [[54,24],[73,35],[73,65],[54,81],[35,65],[35,35]];
const MONOGRAM: Polygon = [[39,38],[48,38],[48,58],[51,63],[57,63],[60,58],[60,38],[69,38],[69,60],[63,71],[45,71],[39,60]];
const CREST: Polygon = [[54,23],[60,31],[54,35],[48,31]];

const points = (polygon: Polygon): string => polygon.map(([x,y]) => `${x},${y}`).join(" ");

/** Returns the shared shield monogram as inline SVG. */
export function markSvg(size = 24, eyes = "#f0d58a"): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="${size}" height="${size}" aria-hidden="true" focusable="false">` +
    `<polygon points="${points(SHELL)}" fill="#cda94d"/>` +
    `<polygon points="${points(INNER)}" fill="#0b0d0f"/>` +
    `<polygon points="${points(MONOGRAM)}" fill="#f0d58a"/>` +
    `<polygon points="${points(CREST)}" fill="${eyes}"/>` +
    `</svg>`
  );
}

/** A data URL for the browser tab icon; no extra asset or network request. */
export function markDataUrl(): string {
  return `data:image/svg+xml,${encodeURIComponent(markSvg(64, "#f0d58a"))}`;
}
