import type { PlayerConfig } from './types';

/** System-level defaults: the lowest level of the preset hierarchy. */
export const DEFAULT_CONFIG: PlayerConfig = {
  theme: {
    accent: '#ff3d3d',
    background: '#000000',
    foreground: '#ffffff',
    panelOpacity: 0.6,
    radius: 6,
    controlSize: 'normal',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  layout: {
    left: ['play', 'rewind', 'forward', 'volume', 'time'],
    right: ['speed', 'pip', 'fullscreen'],
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
  },
};
