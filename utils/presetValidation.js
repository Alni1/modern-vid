/**
 * Server-side validation of player presets. Mirrors the player's configuration model
 * (player/src/config/types.ts): unknown keys and values of a wrong type or range are dropped,
 * so a stored preset can never break the player or inject CSS.
 */
const CONTROLS = ['play', 'rewind', 'forward', 'volume', 'time', 'spacer', 'speed', 'quality', 'settings', 'pip', 'theater', 'captions', 'loop', 'fullscreen'];
const ACTIONS = ['togglePlay', 'seekBack', 'seekForward', 'volumeUp', 'volumeDown', 'toggleMute', 'toggleFullscreen',
  'speedUp', 'speedDown', 'toggleStats', 'toggleSettings', 'toggleTheater', 'toggleCaptions', 'abLoop'];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const color = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined);
const num = (min, max) => (v) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const oneOf = (...values) => (v) => (values.includes(v) ? v : undefined);
const font = (v) => (typeof v === 'string' && v.length <= 120 && /^[\w\s,"'-]+$/.test(v) ? v : undefined);
const controlList = (v) => {
  if (!Array.isArray(v) || v.length > CONTROLS.length) return undefined;
  const seen = new Set();
  return v.filter((id) => CONTROLS.includes(id) && !seen.has(id) && seen.add(id));
};
const keyList = (v) => (Array.isArray(v) && v.length <= 3 && v.every((k) => typeof k === 'string' && k.length >= 1 && k.length <= 20) ? v : undefined);
const speeds = (v) => (Array.isArray(v) && v.length >= 1 && v.length <= 12 && v.every((s) => typeof s === 'number' && s >= 0.1 && s <= 4) ? v : undefined);
const maxHeight = (v) => (v === null || (Number.isInteger(v) && v >= 144 && v <= 4320) ? v : undefined);

const SCHEMA = {
  theme: {
    accent: color, background: color, foreground: color,
    panelOpacity: num(0, 1), radius: num(0, 32), controlSize: oneOf('compact', 'normal', 'large'), fontFamily: font,
  },
  layout: { left: controlList, right: controlList, autoHide: bool, autoHideDelay: num(500, 20000), centerPlay: bool },
  behavior: {
    autoplay: bool, rememberVolume: bool, rememberSpeed: bool, seekStep: num(1, 120), speeds, useAuthorTheme: bool,
    resume: bool, autoplayNext: bool,
  },
  quality: { algorithm: oneOf('adaptive', 'hybrid', 'throughput', 'buffer'), mode: oneOf('balanced', 'eco', 'stable', 'quality'), maxHeight },
  hotkeys: Object.fromEntries(ACTIONS.map((a) => [a, keyList])),
  subtitles: {
    lang: (v) => (v === null || (typeof v === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(v)) ? v : undefined),
    size: oneOf('small', 'normal', 'large', 'xlarge'), color, background: color, backgroundOpacity: num(0, 1),
    position: oneOf('bottom', 'top'), edge: oneOf('none', 'outline', 'shadow'),
  },
};

function clean(value, schema) {
  if (!isObj(value)) return {};
  const out = {};
  for (const [key, rule] of Object.entries(schema)) {
    if (!(key in value)) continue;
    if (typeof rule === 'function') {
      const v = rule(value[key]);
      if (v !== undefined) out[key] = v;
    } else {
      const v = clean(value[key], rule);
      if (Object.keys(v).length) out[key] = v;
    }
  }
  return out;
}

/** A viewer may change every group. */
const sanitizeViewerPreset = (preset) => clean(preset, SCHEMA);

/** A channel author may change only the appearance. */
const sanitizeAuthorTheme = (theme) => clean(theme, SCHEMA.theme);

module.exports = { sanitizeViewerPreset, sanitizeAuthorTheme };
