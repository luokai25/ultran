/** Ultron v3 plasma-core identity, shared by the app UI, browser icon and launcher. */
export function markSvg(size = 24, glow = "#c7cbd1"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="${size}" height="${size}" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="ultron-core"><stop stop-color="#f3f4f6"/><stop offset=".16" stop-color="#cfd3d9"/><stop offset=".42" stop-color="#9ca3af"/><stop offset=".76" stop-color="#525861" stop-opacity=".88"/><stop offset="1" stop-color="#252a31" stop-opacity="0"/></radialGradient>
      <filter id="ultron-glow"><feGaussianBlur stdDeviation="3.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <g fill="none" stroke="#aeb4bd" stroke-linecap="round" opacity=".62">
      <path d="M8 52 C23 9 80 5 101 43 C116 70 72 104 30 91 C8 84 -1 68 8 52Z" stroke-width="1.5"/>
      <path d="M15 72 C27 26 77 17 95 49 M18 37 C45 5 91 26 91 66" stroke-width=".8" opacity=".8"/>
      <path d="M12 56 L35 35 L52 48 L74 24 L96 41 M15 75 L39 61 L57 79 L82 58 L98 70" stroke-width=".7" opacity=".65"/>
    </g>
    <g filter="url(#ultron-glow)">
      <path d="M18 43 L34 18 L46 37 L39 54 L19 61Z" fill="#08090d" stroke="#9ca3af" stroke-width="1.6"/>
      <path d="M75 17 L93 34 L82 53 L66 44 L62 29Z" fill="#09090d" stroke="#9ca3af" stroke-width="1.6"/>
      <path d="M82 69 L97 78 L77 98 L61 82 L67 66Z" fill="#09090d" stroke="#858c96" stroke-width="1.6"/>
      <path d="M15 76 L31 66 L43 82 L31 98 L12 91Z" fill="#09090d" stroke="#858c96" stroke-width="1.4"/>
      <circle cx="54" cy="54" r="30" fill="url(#ultron-core)" stroke="#9ca3af" stroke-width="1.8"/>
      <circle cx="54" cy="54" r="20" fill="none" stroke="#d1d5db" stroke-width="1.4" opacity=".88"/>
      <circle cx="54" cy="54" r="11" fill="#9ca3af" opacity=".92"/>
      <circle cx="54" cy="54" r="5" fill="#f3f4f6"/>
    </g>
    <g fill="#d1d5db"><circle cx="10" cy="29" r="1.8"/><circle cx="100" cy="55" r="2"/><circle cx="43" cy="7" r="1.2"/><circle cx="68" cy="103" r="1.5"/></g>
  </svg>`;
}
export function markDataUrl(): string { return `data:image/svg+xml,${encodeURIComponent(markSvg(64))}`; }
