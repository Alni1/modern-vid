import type { ThemeConfig } from '../config/types';

const SIZE: Record<ThemeConfig['controlSize'], number> = { compact: 32, normal: 40, large: 52 };

function hexToRgb(hex: string): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : '0, 0, 0';
}

/** Theme -> CSS custom properties applied to the host element. */
export function themeVariables(t: ThemeConfig): Record<string, string> {
  return {
    '--mv-accent': t.accent,
    '--mv-bg': t.background,
    '--mv-fg': t.foreground,
    '--mv-panel-rgb': hexToRgb(t.background),
    '--mv-panel-alpha': String(t.panelOpacity),
    '--mv-radius': `${t.radius}px`,
    '--mv-size': `${SIZE[t.controlSize]}px`,
    '--mv-font': t.fontFamily,
  };
}

export const PLAYER_CSS = /* css */ `
:host {
  display: block;
  position: relative;
  aspect-ratio: 16 / 9;
  width: 100%;
  background: #000;
  color: var(--mv-fg);
  font-family: var(--mv-font);
  font-size: calc(var(--mv-size) * 0.35);
  overflow: hidden;
  border-radius: var(--mv-radius);
  outline: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
:host(:focus-visible) { box-shadow: 0 0 0 3px var(--mv-accent); }
:host(:fullscreen) { border-radius: 0; aspect-ratio: auto; width: 100vw; height: 100vh; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }

video { position: absolute; inset: 0; width: 100%; height: 100%; background: #000; object-fit: contain; }

.mv-overlay { position: absolute; inset: 0; display: grid; place-items: center; cursor: pointer; }
.mv-big-play {
  width: calc(var(--mv-size) * 1.8); height: calc(var(--mv-size) * 1.8);
  border-radius: 50%; border: 0; cursor: pointer; display: grid; place-items: center;
  background: rgba(var(--mv-panel-rgb), var(--mv-panel-alpha)); color: var(--mv-fg);
  transition: transform .15s ease, background .15s ease;
}
.mv-big-play:hover { transform: scale(1.06); background: var(--mv-accent); }
.mv-big-play svg { width: 50%; height: 50%; }
.mv-spinner {
  width: calc(var(--mv-size) * 1.4); height: calc(var(--mv-size) * 1.4); border-radius: 50%;
  border: 4px solid rgba(255,255,255,.25); border-top-color: var(--mv-accent);
  animation: mv-spin .8s linear infinite; pointer-events: none;
}
@keyframes mv-spin { to { transform: rotate(360deg); } }
.mv-error {
  position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 1em;
  background: rgba(0,0,0,.75); font-size: 1rem;
}

.mv-controls {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 24px 10px 6px;
  background: linear-gradient(to top, rgba(var(--mv-panel-rgb), calc(var(--mv-panel-alpha) + .2)), transparent);
  transition: opacity .25s ease, transform .25s ease;
}
:host([data-idle]) .mv-controls { opacity: 0; transform: translateY(8px); pointer-events: none; }
:host([data-idle]) { cursor: none; }
.mv-bar { display: flex; align-items: center; gap: 2px; height: var(--mv-size); }
.mv-group { display: flex; align-items: center; gap: 2px; min-width: 0; }
.mv-group.mv-right { margin-left: auto; }

.mv-btn {
  width: var(--mv-size); height: var(--mv-size); flex: none;
  display: grid; place-items: center; padding: 0; border: 0; border-radius: var(--mv-radius);
  background: transparent; color: inherit; cursor: pointer; font: inherit;
}
.mv-btn:hover, .mv-btn:focus-visible { background: rgba(255,255,255,.14); outline: none; }
.mv-btn:focus-visible { box-shadow: inset 0 0 0 2px var(--mv-accent); }
.mv-btn svg { width: 60%; height: 60%; overflow: visible; }
.mv-btn.mv-active { color: var(--mv-accent); }
svg .f { fill: currentColor; }
svg .s { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.mv-text-btn { width: auto; min-width: var(--mv-size); padding: 0 .6em; font-weight: 600; }

.mv-time { padding: 0 .6em; white-space: nowrap; font-variant-numeric: tabular-nums; }
.mv-spacer { flex: 1; }

.mv-volume { display: flex; align-items: center; }
.mv-volume-slider {
  -webkit-appearance: none; appearance: none; width: 0; opacity: 0; height: 4px; margin: 0;
  border-radius: 2px; cursor: pointer; transition: width .2s ease, opacity .2s ease, margin .2s ease;
  background: linear-gradient(to right, var(--mv-fg) var(--mv-volume, 100%), rgba(255,255,255,.3) var(--mv-volume, 100%));
}
.mv-volume:hover .mv-volume-slider, .mv-volume-slider:focus-visible { width: calc(var(--mv-size) * 2); opacity: 1; margin: 0 .5em; }
.mv-volume-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--mv-fg); }
.mv-volume-slider::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 50%; background: var(--mv-fg); }

.mv-progress { position: relative; height: 16px; display: flex; align-items: center; cursor: pointer; touch-action: none; outline: none; }
.mv-track { position: relative; width: 100%; height: 4px; border-radius: 2px; background: rgba(255,255,255,.25); transition: height .1s ease; }
.mv-progress:hover .mv-track, .mv-progress.mv-dragging .mv-track, .mv-progress:focus-visible .mv-track { height: 6px; }
.mv-buffered, .mv-played { position: absolute; left: 0; top: 0; bottom: 0; border-radius: inherit; }
.mv-buffered { width: var(--mv-buffered, 0%); background: rgba(255,255,255,.4); }
.mv-played { width: var(--mv-played, 0%); background: var(--mv-accent); }
.mv-thumb {
  position: absolute; top: 50%; left: var(--mv-played, 0%); width: 14px; height: 14px; border-radius: 50%;
  background: var(--mv-accent); transform: translate(-50%, -50%) scale(0); transition: transform .1s ease;
}
.mv-progress:hover .mv-thumb, .mv-progress.mv-dragging .mv-thumb, .mv-progress:focus-visible .mv-thumb { transform: translate(-50%, -50%) scale(1); }
.mv-tooltip {
  position: absolute; bottom: 20px; transform: translateX(-50%); padding: 2px 6px; border-radius: 4px;
  background: rgba(var(--mv-panel-rgb), .85); font-size: .9em; white-space: nowrap; pointer-events: none;
}

.mv-menu-wrap { position: relative; }
.mv-menu {
  position: absolute; right: 0; bottom: calc(100% + 6px); min-width: 7.5em; padding: 4px;
  max-height: 60vh; overflow-y: auto;
  background: rgba(var(--mv-panel-rgb), .92); border-radius: var(--mv-radius); box-shadow: 0 4px 16px rgba(0,0,0,.4);
}
.mv-menu-item {
  display: block; width: 100%; padding: .45em .8em; border: 0; border-radius: calc(var(--mv-radius) * .7);
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.mv-menu-item:hover, .mv-menu-item:focus-visible { background: rgba(255,255,255,.14); outline: none; }
.mv-menu-item[aria-checked="true"] { color: var(--mv-accent); font-weight: 600; }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation-duration: 1.5s !important; } }
`;
