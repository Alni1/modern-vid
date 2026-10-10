import { MVPlayerElement } from './MVPlayerElement';

export { MVPlayerElement };
export { PlayerCore } from './core/PlayerCore';
export type { PlaybackState } from './core/PlayerCore';
export { resolveConfig, deepMerge } from './config/merge';
export { DEFAULT_CONFIG } from './config/defaults';
export { registerControl } from './ui/controls';
export { findConflicts } from './hotkeys';
export type * from './config/types';

if (!customElements.get('mv-player')) {
  customElements.define('mv-player', MVPlayerElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'mv-player': MVPlayerElement;
  }
}
