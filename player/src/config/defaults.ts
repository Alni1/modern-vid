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
  theater: 'Theater mode',
  captions: 'Subtitles',
  loop: 'A-B repeat',
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
  toggleTheater: 'Theater mode',
  toggleCaptions: 'Subtitles on / off',
  abLoop: 'A-B repeat',
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
    right: ['loop', 'captions', 'speed', 'quality', 'settings', 'theater', 'pip', 'fullscreen'],
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
    resume: true,
    autoplayNext: true,
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
    toggleTheater: ['t'],
    toggleCaptions: ['c'],
    abLoop: ['b'],
  },
  subtitles: {
    lang: null,
    size: 'normal',
    color: '#ffffff',
    background: '#000000',
    backgroundOpacity: 0.75,
    position: 'bottom',
    edge: 'none',
  },
};
