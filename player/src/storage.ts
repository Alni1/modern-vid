import type { ViewerPreset } from './config/types';

const PREFS_KEY = 'mvplayer:prefs';
const PRESET_KEY = 'mvplayer:preset';

export interface RememberedPrefs {
  volume?: number;
  muted?: boolean;
  rate?: number;
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
};
