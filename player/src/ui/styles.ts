import type { ThemeConfig } from '../config/types';

const SIZE: Record<ThemeConfig['controlSize'], number> = { compact: 32, normal: 40, large: 52 };

/** Black or white, whichever reads better on the given color. */
function contrastOn(hex: string): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#000000' : '#ffffff';
}

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
    '--mv-fg-rgb': hexToRgb(t.foreground),
    '--mv-on-accent': contrastOn(t.accent),
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
.mv-btn.mv-dim { opacity: .45; }
svg .f { fill: currentColor; }
svg .s { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.mv-text-btn { width: auto; min-width: var(--mv-size); padding: 0 .6em; font-weight: 600; }

.mv-time { padding: 0 .6em; white-space: nowrap; font-variant-numeric: tabular-nums; min-width: 0; max-width: 40cqw; overflow: hidden; text-overflow: ellipsis; }
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
/* Chapter boundaries cut small gaps into the bar; the A-B range is highlighted. */
.mv-marks { position: absolute; inset: 0; pointer-events: none; }
.mv-mark { position: absolute; top: -1px; bottom: -1px; width: 3px; margin-left: -1.5px; background: rgba(var(--mv-panel-rgb), .9); }
.mv-loop { position: absolute; top: -2px; bottom: -2px; border-radius: 2px; background: rgba(255,255,255,.35); box-shadow: inset 0 0 0 1px var(--mv-accent); pointer-events: none; }
.mv-loop-badge { position: absolute; right: 2px; bottom: 2px; font-size: 9px; font-weight: 800; line-height: 1; }
.mv-btn.mv-loop { position: relative; }
/* Subtitles drawn by the player with the viewer's style. */

.mv-cc-layer {
  position: absolute; left: 5%; right: 5%; bottom: calc(var(--mv-size) + 34px); z-index: 1;
  display: flex; flex-direction: column; align-items: center; gap: 2px; pointer-events: none; text-align: center;
  transition: bottom .25s ease;
  font-size: calc(clamp(14px, 3.4cqw, 34px) * var(--mv-cc-scale, 1));
}
:host([data-idle]) .mv-cc-layer { bottom: 6%; }
.mv-cc-layer[data-position="top"] { bottom: auto; top: 6%; }
.mv-cue {
  max-width: 100%; padding: .1em .45em; border-radius: 4px; white-space: pre-line; line-height: 1.35;
  color: var(--mv-cc-color, #fff); background: var(--mv-cc-bg, rgba(0,0,0,.75)); text-shadow: var(--mv-cc-shadow, none);
}
.mv-thumb {
  position: absolute; top: 50%; left: var(--mv-played, 0%); width: 14px; height: 14px; border-radius: 50%;
  background: var(--mv-accent); transform: translate(-50%, -50%) scale(0); transition: transform .1s ease;
}
.mv-progress:hover .mv-thumb, .mv-progress.mv-dragging .mv-thumb, .mv-progress:focus-visible .mv-thumb { transform: translate(-50%, -50%) scale(1); }
.mv-tooltip {
  position: absolute; bottom: 20px; transform: translateX(-50%); padding: 2px 6px; border-radius: 4px;
  background: rgba(var(--mv-panel-rgb), .85); font-size: .9em; white-space: nowrap; pointer-events: none;
}

.mv-preview {
  position: absolute; bottom: 22px; transform: translateX(-50%); pointer-events: none; z-index: 2;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
}
.mv-preview-frame {
  width: 100%; overflow: hidden; background: #000; border-radius: max(4px, calc(var(--mv-radius) * .8));
  border: 2px solid rgba(var(--mv-fg-rgb), .9); box-shadow: 0 6px 20px rgba(0,0,0,.5);
}
.mv-preview-img { transform-origin: 0 0; background-repeat: no-repeat; }
.mv-preview-time {
  padding: 2px 8px; border-radius: 4px; background: rgba(var(--mv-panel-rgb), .85); font-size: .9em;
  font-variant-numeric: tabular-nums; text-shadow: 0 1px 2px rgba(0,0,0,.5);
}
.mv-menu-wrap { position: relative; }
.mv-menu {
  position: absolute; right: 0; bottom: calc(100% + 6px); min-width: 7.5em; padding: 4px;
  max-height: 60vh; overflow-y: auto;
  background: rgba(var(--mv-panel-rgb), .92); border-radius: var(--mv-radius); box-shadow: 0 4px 16px rgba(0,0,0,.4);
}
.mv-menu-item {
  display: block; width: 100%; padding: .45em .8em; border: 0; border-radius: calc(var(--mv-radius) * .7);
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; white-space: nowrap;
}
.mv-menu-item:hover, .mv-menu-item:focus-visible { background: rgba(255,255,255,.14); outline: none; }
.mv-menu-item[aria-checked="true"] { color: var(--mv-accent); font-weight: 600; }

.mv-stats {
  position: absolute; top: 10px; left: 10px; padding: 8px 28px 8px 10px; max-width: calc(100% - 20px);
  background: rgba(0,0,0,.78); border-radius: var(--mv-radius); font: 12px/1.45 ui-monospace, Consolas, monospace;
  pointer-events: auto; z-index: 2;
}
.mv-stats table { border-collapse: collapse; }
.mv-stats td { padding: 0 6px 0 0; white-space: nowrap; }
.mv-stats td:first-child { color: rgba(255,255,255,.65); }
.mv-stats-close {
  position: absolute; top: 2px; right: 4px; border: 0; background: none; color: inherit;
  font-size: 16px; cursor: pointer; line-height: 1;
}

.mv-toast {
  position: absolute; left: 12px; bottom: calc(var(--mv-size) + 44px); z-index: 2;
  display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 12px; max-width: calc(100% - 24px);
  background: rgba(0,0,0,.78); border-radius: var(--mv-radius); font-size: 14px;
}
.mv-toast button, .mv-next button {
  border: 0; border-radius: var(--mv-radius); padding: .35em .8em; font: inherit; font-weight: 600; cursor: pointer;
  background: rgba(255,255,255,.16); color: inherit;
}
.mv-toast button:hover, .mv-next button:hover { background: rgba(255,255,255,.26); }
.mv-next {
  position: absolute; right: 12px; bottom: calc(var(--mv-size) + 44px); z-index: 3;
  display: grid; gap: 6px; width: min(320px, calc(100% - 24px)); padding: 12px 14px;
  background: rgba(0,0,0,.85); border-radius: calc(var(--mv-radius) * 1.5); font-size: 14px;
}
.mv-next span { color: rgba(255,255,255,.7); }
.mv-next strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-next div { display: flex; justify-content: flex-end; gap: 8px; }
.mv-next .mv-next-now { background: var(--mv-accent); }

/* Narrow players (phones): smaller buttons; rewind/forward buttons hidden (the arrow keys still work). */
@container (max-width: 520px) {
  .mv-bar { --mv-size: 36px; gap: 0; }
  .mv-controls { padding: 18px 4px 2px; }
  .mv-bar [data-control="rewind"], .mv-bar [data-control="forward"], .mv-bar [data-control="spacer"], .mv-bar [data-control="loop"] { display: none; }
  .mv-time { padding: 0 .3em; font-size: 12px; }
  .mv-text-btn { padding: 0 .35em; min-width: 30px; }
}
@container (max-width: 360px) {
  .mv-bar [data-control="pip"] { display: none; }
}

/* ---------------- settings panel ---------------- */
:host { container-type: inline-size; }
.mv-settings {
  --s-surface: rgba(var(--mv-fg-rgb), .07);
  --s-surface-2: rgba(var(--mv-fg-rgb), .13);
  --s-line: rgba(var(--mv-fg-rgb), .14);
  --s-muted: rgba(var(--mv-fg-rgb), .62);
  --s-r: max(4px, calc(var(--mv-radius) * .8));
  position: absolute; right: 10px; bottom: calc(var(--mv-size) + 34px); z-index: 3;
  width: min(400px, calc(100% - 20px)); max-height: calc(100% - var(--mv-size) - 50px);
  display: flex; flex-direction: column; overflow: hidden;
  font: 13px/1.4 var(--mv-font); color: var(--mv-fg); cursor: default; user-select: none;
  background: rgba(var(--mv-panel-rgb), .9); border: 1px solid var(--s-line);
  border-radius: max(6px, var(--mv-radius)); box-shadow: 0 12px 36px rgba(0,0,0,.45);
  -webkit-backdrop-filter: blur(14px) saturate(1.3); backdrop-filter: blur(14px) saturate(1.3);
  animation: mv-pop .16s ease-out;
}
@keyframes mv-pop { from { opacity: 0; transform: translateY(6px) scale(.98); } }
@container (max-width: 520px) {
  .mv-settings { left: 8px; right: 8px; top: 8px; width: auto; max-height: none; bottom: calc(var(--mv-size) + 28px); }
}
.mv-settings svg { width: 18px; height: 18px; }
.mv-s-head { padding: 10px 10px 0; border-bottom: 1px solid var(--s-line); }
.mv-s-top { display: flex; align-items: center; justify-content: space-between; margin: 0 0 8px 4px; }
.mv-s-title { font-weight: 700; font-size: 14px; letter-spacing: .01em; }
.mv-s-close {
  display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%;
  background: transparent; color: inherit; cursor: pointer;
}
.mv-s-close:hover { background: var(--s-surface-2); }
.mv-s-tabs { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; margin: 0 -2px; padding: 0 2px; }
.mv-s-tabs::-webkit-scrollbar { display: none; }
.mv-s-tab {
  flex: none; border: 0; background: none; color: var(--s-muted); font: inherit; font-size: 12.5px; font-weight: 600;
  padding: 7px 8px 9px; cursor: pointer; position: relative; border-radius: var(--s-r) var(--s-r) 0 0;
}
.mv-s-tab:hover { color: var(--mv-fg); background: var(--s-surface); }
.mv-s-tab[aria-selected="true"] { color: var(--mv-fg); }
.mv-s-tab[aria-selected="true"]::after {
  content: ''; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 3px; border-radius: 3px 3px 0 0; background: var(--mv-accent);
}
.mv-settings :focus-visible { outline: 2px solid var(--mv-accent); outline-offset: 1px; }
.mv-s-body { overflow-y: auto; padding: 6px 12px 12px; scrollbar-width: thin; scrollbar-color: var(--s-surface-2) transparent; }
.mv-s-row { display: flex; align-items: center; gap: 10px; min-height: 40px; border-bottom: 1px solid var(--s-line); }
.mv-s-row:last-child { border-bottom: 0; }
.mv-s-label { flex: 1; min-width: 0; }
.mv-s-locked { opacity: .45; }
.mv-s-locked * { cursor: not-allowed !important; }
.mv-s-sub { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--s-muted); margin: 12px 0 6px; }
.mv-s-hint { margin: 8px 0; color: var(--s-muted); font-size: 12px; }
.mv-s-warn { margin: 8px 0 0; padding: 6px 8px; border-radius: var(--s-r); background: rgba(255,176,32,.14); color: #ffb020; font-size: 12px; }

/* inputs */
.mv-s-select { position: relative; display: inline-flex; max-width: 62%; }
.mv-s-select::after {
  content: ''; position: absolute; right: 10px; top: 50%; width: 6px; height: 6px; margin-top: -5px; pointer-events: none;
  border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg); opacity: .7;
}
.mv-s-input {
  -webkit-appearance: none; appearance: none; max-width: 100%; font: inherit; color: inherit; cursor: pointer;
  background: var(--s-surface); border: 1px solid var(--s-line); border-radius: var(--s-r); padding: 5px 28px 5px 10px;
}
.mv-s-input:hover { background: var(--s-surface-2); }
.mv-s-input option { color: #111; background: #fff; }
.mv-s-switch {
  -webkit-appearance: none; appearance: none; flex: none; position: relative; width: 36px; height: 20px; margin: 0;
  border-radius: 10px; background: var(--s-surface-2); border: 1px solid var(--s-line); cursor: pointer; transition: background .15s ease;
}
.mv-s-switch::before {
  content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--mv-fg); transition: transform .15s ease, background .15s ease;
}
.mv-s-switch:checked { background: var(--mv-accent); border-color: var(--mv-accent); }
.mv-s-switch:checked::before { transform: translateX(16px); background: var(--mv-on-accent); }
.mv-s-range { display: flex; align-items: center; gap: 8px; }
.mv-s-slider {
  -webkit-appearance: none; appearance: none; width: 120px; height: 4px; margin: 0; border-radius: 2px; cursor: pointer;
  background: linear-gradient(to right, var(--mv-accent) var(--p, 50%), var(--s-surface-2) var(--p, 50%));
}
.mv-s-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--mv-fg); box-shadow: 0 1px 4px rgba(0,0,0,.4); }
.mv-s-slider::-moz-range-thumb { width: 14px; height: 14px; border: 0; border-radius: 50%; background: var(--mv-fg); }
.mv-s-value { min-width: 3.2em; text-align: right; font-variant-numeric: tabular-nums; color: var(--s-muted); }
.mv-s-colors { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 5px; max-width: 64%; padding: 6px 0; }
.mv-s-swatch {
  width: 20px; height: 20px; padding: 0; border-radius: 50%; cursor: pointer;
  border: 1px solid rgba(var(--mv-fg-rgb), .3); transition: transform .1s ease;
}
.mv-s-swatch:hover { transform: scale(1.12); }
.mv-s-swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px rgba(var(--mv-panel-rgb), 1), 0 0 0 4px var(--mv-fg); }
.mv-s-color {
  -webkit-appearance: none; appearance: none; width: 24px; height: 24px; padding: 0; border: 1px dashed rgba(var(--mv-fg-rgb), .5);
  border-radius: 50%; background: none; cursor: pointer; overflow: hidden;
}
.mv-s-color::-webkit-color-swatch-wrapper { padding: 2px; }
.mv-s-color::-webkit-color-swatch { border: 0; border-radius: 50%; }
.mv-s-color::-moz-color-swatch { border: 0; border-radius: 50%; }

/* buttons */
.mv-s-btn {
  font: inherit; font-weight: 600; color: inherit; background: var(--s-surface-2); border: 0; border-radius: var(--s-r);
  padding: 6px 12px; cursor: pointer; white-space: nowrap; transition: background .12s ease;
}
.mv-s-btn:hover { background: rgba(var(--mv-fg-rgb), .2); }
.mv-s-reset { margin-top: 12px; background: transparent; border: 1px solid var(--s-line); color: var(--s-muted); }
.mv-s-reset:hover { color: var(--mv-fg); }
.mv-s-danger { color: #ff6b6b; }
.mv-s-listening { background: var(--mv-accent); color: var(--mv-on-accent); animation: mv-blink 1s ease-in-out infinite; }
@keyframes mv-blink { 50% { opacity: .65; } }
.mv-s-icon {
  display: grid; place-items: center; flex: none; width: 26px; height: 26px; padding: 0; font: inherit; color: var(--s-muted);
  background: transparent; border: 0; border-radius: 50%; cursor: pointer;
}
.mv-s-icon:hover { background: var(--s-surface-2); color: var(--mv-fg); }

/* quality modes */
.mv-s-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 4px; }
.mv-s-mode {
  position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left;
  font: inherit; color: inherit; background: var(--s-surface); border: 1px solid var(--s-line); border-radius: var(--s-r);
  padding: 8px 10px; cursor: pointer; transition: border-color .12s ease, background .12s ease;
}
.mv-s-mode:hover { background: var(--s-surface-2); }
.mv-s-mode span { font-size: 11px; color: var(--s-muted); }
.mv-s-mode[aria-checked="true"] { border-color: var(--mv-accent); box-shadow: inset 0 0 0 1px var(--mv-accent); }
.mv-s-mode[aria-checked="true"]::after {
  content: ''; position: absolute; top: 8px; right: 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--mv-accent);
}

/* hotkeys */
.mv-s-keys .mv-s-row { min-height: 38px; }
.mv-s-chips { display: flex; gap: 4px; }
.mv-s-kbd {
  min-width: 22px; text-align: center; font: 600 11px/1 ui-monospace, Consolas, monospace; padding: 5px 6px; border-radius: 5px;
  background: var(--s-surface-2); border: 1px solid var(--s-line); border-bottom-width: 2px;
}
.mv-s-conflict { border-color: #ffb020; color: #ffb020; }
.mv-s-none { color: var(--s-muted); font-size: 12px; }

/* preset */
.mv-s-json {
  width: 100%; min-height: 150px; resize: vertical; margin: 0; font: 12px/1.45 ui-monospace, Consolas, monospace; color: inherit;
  background: rgba(0,0,0,.25); border: 1px solid var(--s-line); border-radius: var(--s-r); padding: 8px; user-select: text;
}
.mv-s-actions { justify-content: flex-end; gap: 6px; border-bottom: 0; margin-top: 4px; }

/* layout editor (drag and drop) */
.mv-le { display: grid; gap: 2px; margin-bottom: 4px; touch-action: none; user-select: none; -webkit-user-select: none; }
.mv-le .mv-s-sub { margin: 10px 0 5px; }
.mv-le-area {
  display: flex; flex-wrap: wrap; align-items: center; gap: 5px; min-height: 42px; padding: 6px;
  border: 1px dashed var(--s-line); border-radius: var(--s-r); background: var(--s-surface);
  transition: background .12s ease, border-color .12s ease;
}
.mv-le-hidden .mv-le-area { background: transparent; }
.mv-le-area.mv-le-over { border-color: var(--mv-accent); border-style: solid; background: var(--s-surface-2); }
.mv-le-chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px 5px 7px; font: inherit; font-size: 12px; font-weight: 600; color: inherit;
  background: rgba(var(--mv-panel-rgb), .9); border: 1px solid var(--s-line); border-radius: var(--s-r);
  box-shadow: 0 1px 2px rgba(0,0,0,.25); cursor: grab; touch-action: none; transition: background .12s ease, transform .12s ease;
}
.mv-le-chip:hover { background: var(--s-surface-2); transform: translateY(-1px); }
.mv-le-glyph { display: inline-grid; place-items: center; min-width: 16px; height: 16px; font-size: 10px; font-weight: 800; color: var(--mv-accent); }
.mv-le-glyph svg { width: 16px; height: 16px; }
.mv-le-dragging { opacity: .25; }
.mv-le-active, .mv-le-active * { cursor: grabbing !important; }
.mv-le-ghost {
  position: fixed; z-index: 10; pointer-events: none; transform: translate(-50%, -50%) rotate(-3deg) scale(1.05);
  background: var(--mv-accent); color: var(--mv-on-accent); border-color: transparent; box-shadow: 0 10px 24px rgba(0,0,0,.5);
}
.mv-le-ghost .mv-le-glyph { color: inherit; }
.mv-le-placeholder { width: 3px; height: 28px; border-radius: 2px; background: var(--mv-accent); box-shadow: 0 0 8px var(--mv-accent); }
.mv-le-empty { font-size: 12px; color: var(--s-muted); padding: 0 4px; }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation-duration: 1.5s !important; } }
`;
