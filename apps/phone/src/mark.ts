/** Ultran's plasma-orb identity, shared by the app UI, browser icon and launcher. */
export function markSvg(size = 24, glow = "#f0d58a"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="${size}" height="${size}" aria-hidden="true" focusable="false">` +
    `<defs><radialGradient id="core"><stop stop-color="#fff4c7"/><stop offset=".24" stop-color="${glow}"/><stop offset=".62" stop-color="#cda94d" stop-opacity=".48"/><stop offset="1" stop-color="#cda94d" stop-opacity="0"/></radialGradient></defs>` +
    `<circle cx="54" cy="54" r="39" fill="none" stroke="#cda94d" stroke-width="2.5" opacity=".82"/>` +
    `<ellipse cx="54" cy="54" rx="47" ry="17" fill="none" stroke="${glow}" stroke-width="2.4" transform="rotate(-32 54 54)" opacity=".9"/>` +
    `<ellipse cx="54" cy="54" rx="44" ry="13" fill="none" stroke="#cda94d" stroke-width="1.5" transform="rotate(48 54 54)" opacity=".7"/>` +
    `<circle cx="54" cy="54" r="27" fill="url(#core)"/><circle cx="54" cy="54" r="11" fill="${glow}" opacity=".92"/><circle cx="54" cy="54" r="5" fill="#fff9e8"/>` +
    `<circle cx="91" cy="33" r="3.5" fill="${glow}"/><circle cx="19" cy="68" r="2.5" fill="#cda94d"/>` +
    `</svg>`;
}
export function markDataUrl(): string { return `data:image/svg+xml,${encodeURIComponent(markSvg(64))}`; }
