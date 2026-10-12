import type { ControlId, HotkeyAction, PlayerConfig } from './types';

/** Font choices offered in the settings panel (CSS font stacks). */
export const FONT_STACKS: Record<string, string> = {
  System: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  Serif: 'Georgia, "Times New Roman", serif',
  Monospace: 'ui-monospace, Consolas, "Courier New", monospace',
  Rounded: '"Trebuchet MS", "Segoe UI", Verdana, sans-serif',
};

/** Every control that can be placed on the control bar, with a human-readable name. */
export const CONTROL_NAMES: Record<ControlId, string> = {
  play: 'Play / pause',
  rewind: 'Rewind',
  forward: 'Forward',
  volume: 'Volume',
  time: 'Time',
  spacer: 'Spacer',
  speed: 'Speed',
  quality: 'Quality',
  settings: 'Settings',
  pip: 'Picture in picture',
  fullscreen: 'Full screen',
};

export const HOTKEY_NAMES: Record<HotkeyAction, string> = {
  togglePlay: 'Play / pause',
  seekBack: 'Rewind',
  seekForward: 'Forward',
  volumeUp: 'Volume up',
  volumeDown: 'Volume down',
  toggleMute: 'Mute',
  toggleFullscreen: 'Full screen',
  speedUp: 'Faster',
  speedDown: 'Slower',
  toggleStats: 'Statistics',
  toggleSettings: 'Settings panel',
};

/** System-level defaults: the lowest level of the preset hierarchy. */
export const DEFAULT_CONFIG: PlayerConfig = {
  theme: {
    accent: '#ff3d3d',
    background: '#000000',
    foreground: '#ffffff',
    panelOpacity: 0.6,
    radius: 6,
    controlSize: 'normal',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', // FONT_STACKS.System
  },
  layout: {
    left: ['play', 'rewind', 'forward', 'volume', 'time'],
    right: ['speed', 'quality', 'settings', 'pip', 'fullscreen'],
    autoHide: true,
    autoHideDelay: 2500,
    centerPlay: true,
  },
  behavior: {
    autoplay: false,
    rememberVolume: true,
    rememberSpeed: false,
    seekStep: 10,
    speeds: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3],
    useAuthorTheme: true,
  },
  quality: {
    algorithm: 'adaptive',
    mode: 'balanced',
    maxHeight: null,
  },
  hotkeys: {
    togglePlay: [' ', 'k'],
    seekBack: ['ArrowLeft', 'j'],
    seekForward: ['ArrowRight', 'l'],
    volumeUp: ['ArrowUp'],
    volumeDown: ['ArrowDown'],
    toggleMute: ['m'],
    toggleFullscreen: ['f'],
    speedUp: ['>'],
    speedDown: ['<'],
    toggleStats: ['i'],
    toggleSettings: ['s'],
  },
};
