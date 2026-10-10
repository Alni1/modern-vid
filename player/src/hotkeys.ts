import type { HotkeyAction, HotkeysConfig, PlayerConfig } from './config/types';
import type { PlayerCore } from './core/PlayerCore';

function normalize(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** Builds a key -> action lookup; later actions do not override earlier ones (conflict-safe). */
export function buildKeyMap(hotkeys: HotkeysConfig): Map<string, HotkeyAction> {
  const map = new Map<string, HotkeyAction>();
  (Object.keys(hotkeys) as HotkeyAction[]).forEach((action) => {
    hotkeys[action].forEach((k) => {
      const key = normalize(k);
      if (!map.has(key)) map.set(key, action);
    });
  });
  return map;
}

/** Returns the keys that are bound to more than one action. */
export function findConflicts(hotkeys: HotkeysConfig): string[] {
  const seen = new Map<string, number>();
  Object.values(hotkeys).flat().forEach((k) => seen.set(normalize(k), (seen.get(normalize(k)) ?? 0) + 1));
  return [...seen].filter(([, n]) => n > 1).map(([k]) => k);
}

export function runAction(action: HotkeyAction, core: PlayerCore, config: PlayerConfig): void {
  const speeds = config.behavior.speeds;
  const rate = core.video.playbackRate;
  switch (action) {
    case 'togglePlay': core.togglePlay(); break;
    case 'seekBack': core.seekBy(-config.behavior.seekStep); break;
    case 'seekForward': core.seekBy(config.behavior.seekStep); break;
    case 'volumeUp': core.setVolume(core.video.volume + 0.05); core.setMuted(false); break;
    case 'volumeDown': core.setVolume(core.video.volume - 0.05); break;
    case 'toggleMute': core.setMuted(!core.video.muted); break;
    case 'toggleFullscreen': void core.toggleFullscreen(); break;
    case 'speedUp': core.setRate(speeds.find((s) => s > rate + 1e-3) ?? rate); break;
    case 'speedDown': core.setRate([...speeds].reverse().find((s) => s < rate - 1e-3) ?? rate); break;
  }
}
