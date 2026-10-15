import type { ViewerPreset } from './config/types';

const PREFS_KEY = 'mvplayer:prefs';
const PRESET_KEY = 'mvplayer:preset';
const THROUGHPUT_KEY = 'mvplayer:throughput';
const POSITIONS_KEY = 'mvplayer:positions';
/** Playback positions are kept for this many most recent videos. */
const MAX_POSITIONS = 200;

export interface RememberedPrefs {
  volume?: number;
  muted?: boolean;
  rate?: number;
  theater?: boolean;
}

// localStorage can be unavailable (private mode, blocked storage) — never let it break playback.
function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export const storage = {
  loadPrefs: (): RememberedPrefs => read<RememberedPrefs>(PREFS_KEY) ?? {},
  savePref: (key: keyof RememberedPrefs, value: number | boolean): void => {
    write(PREFS_KEY, { ...(read<RememberedPrefs>(PREFS_KEY) ?? {}), [key]: value });
  },
  loadPreset: (): ViewerPreset | null => read<ViewerPreset>(PRESET_KEY),
  savePreset: (preset: ViewerPreset): void => write(PRESET_KEY, preset),
  /** Last throughput estimate (bits/s): lets the next session start at a suitable quality. */
  loadThroughput: (): number => Number(read<number>(THROUGHPUT_KEY)) || 0,
  saveThroughput: (bps: number): void => {
    if (bps > 0) write(THROUGHPUT_KEY, Math.round(bps));
  },
  /** Position (s) where the viewer stopped watching the video `key`, or 0. */
  loadPosition: (key: string): number => {
    const all = read<Record<string, number>>(POSITIONS_KEY) ?? {};
    return typeof all[key] === 'number' ? all[key] : 0;
  },
  /** Saves (or with 0 removes) the position; the most recent entries are kept at the end. */
  savePosition: (key: string, seconds: number): void => {
    const all = read<Record<string, number>>(POSITIONS_KEY) ?? {};
    delete all[key];
    if (seconds > 0) all[key] = Math.round(seconds);
    const keys = Object.keys(all);
    keys.slice(0, Math.max(0, keys.length - MAX_POSITIONS)).forEach((k) => delete all[k]);
    write(POSITIONS_KEY, all);
  },
};
