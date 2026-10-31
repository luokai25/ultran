/**
 * Ultran's orbital U mark. Kept as inline SVG so the app shell, favicon and
 * Android launcher can share the same geometry and warm-gold identity.
 */
export function markSvg(size = 24, eyes = "var(--eye, #f7dfa0)"): string {
  const height = size;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="${size}" height="${height}" aria-hidden="true" focusable="false">` +
    `<circle cx="54" cy="54" r="37" fill="none" stroke="#cda94d" stroke-width="5"/>` +
    `<path d="M34 34v21c0 27 40 27 40 0V34" fill="none" stroke="#f0d58a" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M54 23l6 7-6 7-6-7z" fill="${eyes}"/>` +
    `<circle cx="81" cy="35" r="3" fill="#f0d58a"/>` +
    `</svg>`
  );
}

/** A data URL for the browser tab icon; no extra asset or network request. */
export function markDataUrl(): string {
  return `data:image/svg+xml,${encodeURIComponent(markSvg(64, "#f7dfa0"))}`;
}
