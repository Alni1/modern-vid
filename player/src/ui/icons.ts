// 24x24 inline SVG icons (simple geometric shapes, own drawings).
// `fill` paths are filled, `stroke` paths are outlined.
const svg = (fill: string, stroke = ''): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
  (fill ? `<path class="f" d="${fill}"/>` : '') +
  (stroke ? `<path class="s" d="${stroke}"/>` : '') +
  `</svg>`;

export const icons = {
  play: svg('M8 5.5v13l10.5-6.5z'),
  pause: svg('M7 5h3.5v14H7zM13.5 5H17v14h-3.5z'),
  replay: svg('', 'M5 12a7 7 0 1 0 2.05-4.95M5 4v4h4'),
  rewind: svg('M11 7v10l-7-5zM19 7v10l-7-5z'),
  forward: svg('M13 7v10l7-5zM5 7v10l7-5z'),
  volume: svg('M4 9h4l5-4v14l-5-4H4z', 'M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12'),
  volumeLow: svg('M4 9h4l5-4v14l-5-4H4z', 'M16 8.5a5 5 0 0 1 0 7'),
  muted: svg('M4 9h4l5-4v14l-5-4H4z', 'M16 9l5 6M21 9l-5 6'),
  fullscreen: svg('', 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5'),
  exitFullscreen: svg('', 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5'),
  settings: svg('', 'M4 7h9M17 7h3M15 4.5v5M4 17h3M11 17h9M9 14.5v5'),
  pip: svg('M12 12h7v5h-7z', 'M3 5h18v14H3z'),
};
