/** Identifiers of UI controls that can be placed on the control panels. */
export type ControlId =
  | 'play'
  | 'rewind'
  | 'forward'
  | 'volume'
  | 'time'
  | 'spacer'
  | 'speed'
  | 'quality'
  | 'pip'
  | 'settings'
  | 'fullscreen';

export type ControlSize = 'compact' | 'normal' | 'large';

/** Visual appearance. The only group an author (channel owner) may override. */
export interface ThemeConfig {
  accent: string;
  background: string;
  foreground: string;
  /** Opacity of the control panel background, 0..1. */
  panelOpacity: number;
  /** Corner radius of buttons and menus, px. */
  radius: number;
  controlSize: ControlSize;
  fontFamily: string;
}

/** Which controls are shown and where. */
export interface LayoutConfig {
  left: ControlId[];
  right: ControlId[];
  /** Hide the controls while playing and the pointer is idle. */
  autoHide: boolean;
  /** Delay before auto-hiding, ms. */
  autoHideDelay: number;
  /** Show the big play button in the centre when paused. */
  centerPlay: boolean;
}

export interface BehaviorConfig {
  autoplay: boolean;
  rememberVolume: boolean;
  rememberSpeed: boolean;
  /** Seek step for arrow keys / rewind buttons, seconds. */
  seekStep: number;
  /** Speeds offered in the speed menu. */
  speeds: number[];
  /** Apply the channel author's theme (false = always use the viewer's own appearance). */
  useAuthorTheme: boolean;
}

export type AbrAlgorithmName = 'adaptive' | 'hybrid' | 'throughput' | 'buffer';
export type QualityMode = 'balanced' | 'eco' | 'stable' | 'quality';

/** Adaptive streaming preferences of the viewer. */
export interface QualityConfig {
  /** ABR algorithm; 'adaptive' is the improved hybrid algorithm of this work. */
  algorithm: AbrAlgorithmName;
  /** Viewer-facing mode: economy, stability, balanced, maximum quality. */
  mode: QualityMode;
  /** Upper limit of the resolution (shorter side, e.g. 720), null = no limit. */
  maxHeight: number | null;
}

/** Player actions that can be bound to keys. */
export type HotkeyAction =
  | 'togglePlay'
  | 'seekBack'
  | 'seekForward'
  | 'volumeUp'
  | 'volumeDown'
  | 'toggleMute'
  | 'toggleFullscreen'
  | 'speedUp'
  | 'speedDown'
  | 'toggleStats'
  | 'toggleSettings';

/** action -> list of KeyboardEvent.key values (case-insensitive). */
export type HotkeysConfig = Record<HotkeyAction, string[]>;

export interface PlayerConfig {
  theme: ThemeConfig;
  layout: LayoutConfig;
  behavior: BehaviorConfig;
  quality: QualityConfig;
  hotkeys: HotkeysConfig;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer _U>
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

/** A preset as stored for a viewer. */
export type ViewerPreset = DeepPartial<PlayerConfig>;

/** What a channel author is allowed to define: appearance only. */
export interface AuthorPreset {
  theme?: Partial<ThemeConfig>;
}
