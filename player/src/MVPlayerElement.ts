import { PlayerCore, type PlaybackState } from './core/PlayerCore';
import { resolveConfig } from './config/merge';
import type { AuthorPreset, PlayerConfig, ViewerPreset } from './config/types';
import { controlRegistry, type Control, type ControlContext } from './ui/controls';
import { ProgressBar } from './ui/ProgressBar';
import { PLAYER_CSS, themeVariables } from './ui/styles';
import { icons } from './ui/icons';
import { buildKeyMap, runAction } from './hotkeys';
import { storage } from './storage';

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    console.warn('[MVPlayer] invalid JSON attribute', value);
    return null;
  }
}

/**
 * <mv-player src="..." poster="..." author-theme='{"accent":"#09f"}'></mv-player>
 *
 * Attributes:
 *  - src           media URL (MP4/WebM now, HLS later)
 *  - poster        poster image URL
 *  - author-theme  JSON with the channel author's theme (appearance only)
 *  - preset        JSON with the viewer's saved preset (from the server);
 *                  when absent the preset stored in the browser is used
 */
export class MVPlayerElement extends HTMLElement {
  static observedAttributes = ['src', 'poster', 'author-theme', 'preset'];

  private shadow: ShadowRoot;
  private video!: HTMLVideoElement;
  private _core: PlayerCore | null = null;
  private _config!: PlayerConfig;
  private controls: Control[] = [];
  private progress: ProgressBar | null = null;
  private els!: {
    bar: HTMLDivElement;
    left: HTMLDivElement;
    right: HTMLDivElement;
    bigPlay: HTMLButtonElement;
    spinner: HTMLDivElement;
    error: HTMLDivElement;
    progressSlot: HTMLDivElement;
  };
  private keyMap = new Map<string, string>();
  private idleTimer = 0;
  private built = false;
  private viewerPreset: ViewerPreset | null = null;
  private lastPaused: boolean | null = null;
  private lastSaved: { volume: number; muted: boolean; rate: number } | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  /** The player core (playback API and event bus). */
  get core(): PlayerCore | null {
    return this._core;
  }

  /** Effective configuration after merging system, author and viewer presets. */
  get config(): PlayerConfig {
    return this._config;
  }

  connectedCallback(): void {
    if (!this.built) this.build();
  }

  disconnectedCallback(): void {
    window.clearTimeout(this.idleTimer);
  }

  attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void {
    if (!this.built || oldValue === value) return;
    if (name === 'src' && value) void this._core?.load(value);
    if (name === 'poster') this.video.poster = value ?? '';
    if (name === 'author-theme' || name === 'preset') this.applyConfig();
  }

  /** Applies a viewer preset immediately and stores it in the browser. */
  setViewerPreset(preset: ViewerPreset, persist = true): void {
    this.viewerPreset = preset;
    if (persist) storage.savePreset(preset);
    this.applyConfig();
  }

  play(): Promise<void> | undefined {
    return this._core?.play();
  }

  pause(): void {
    this._core?.pause();
  }

  private build(): void {
    this.built = true;
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
    this.setAttribute('role', 'region');
    this.setAttribute('aria-label', 'Video player');

    const style = document.createElement('style');
    style.textContent = PLAYER_CSS;
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.preload = 'metadata';
    if (this.getAttribute('poster')) this.video.poster = this.getAttribute('poster') as string;

    const overlay = document.createElement('div');
    overlay.className = 'mv-overlay';
    overlay.innerHTML =
      `<button type="button" class="mv-big-play" aria-label="Play">${icons.play}</button>` +
      '<div class="mv-spinner" hidden></div>';
    const error = document.createElement('div');
    error.className = 'mv-error';
    error.hidden = true;

    const controls = document.createElement('div');
    controls.className = 'mv-controls';
    controls.innerHTML =
      '<div class="mv-progress-slot"></div>' +
      '<div class="mv-bar"><div class="mv-group mv-left"></div><div class="mv-group mv-right"></div></div>';

    this.shadow.append(style, this.video, overlay, error, controls);
    this.els = {
      bar: controls.querySelector('.mv-bar') as HTMLDivElement,
      left: controls.querySelector('.mv-left') as HTMLDivElement,
      right: controls.querySelector('.mv-right') as HTMLDivElement,
      bigPlay: overlay.querySelector('.mv-big-play') as HTMLButtonElement,
      spinner: overlay.querySelector('.mv-spinner') as HTMLDivElement,
      error,
      progressSlot: controls.querySelector('.mv-progress-slot') as HTMLDivElement,
    };

    const core = new PlayerCore(this.video, this);
    this._core = core;
    this.progress = new ProgressBar(core);
    this.els.progressSlot.append(this.progress.el);

    this.viewerPreset = parseJson<ViewerPreset>(this.getAttribute('preset')) ?? storage.loadPreset();
    this.applyConfig();
    this.restorePrefs();
    this.lastSaved = { volume: this.video.volume, muted: this.video.muted, rate: this.video.playbackRate };

    core.bus.on('state', (s) => this.render(s));
    core.bus.on('ready', (s) => {
      this.render(s);
      this.dispatchEvent(new CustomEvent('mv-ready', { detail: s }));
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target === this.els.bigPlay || this.els.bigPlay.contains(e.target as Node)) {
        core.togglePlay();
      }
    });
    overlay.addEventListener('dblclick', (e) => {
      if (e.target === overlay) void core.toggleFullscreen();
    });
    this.addEventListener('keydown', this.onKeyDown);
    this.addEventListener('pointermove', this.wake);
    this.addEventListener('pointerdown', this.wake);
    this.addEventListener('focusin', this.wake);
    this.addEventListener('pointerleave', () => this.scheduleIdle(300));

    const src = this.getAttribute('src');
    if (src) void core.load(src).then(() => {
      if (this._config.behavior.autoplay) void core.play();
    });
    this.render(core.state);
  }

  /** Re-resolves the configuration and rebuilds theme, layout and hotkeys. */
  private applyConfig(): void {
    const author = parseJson<AuthorPreset>(this.getAttribute('author-theme'));
    this._config = resolveConfig(author ? { theme: author as AuthorPreset['theme'] } : null, this.viewerPreset);
    const vars = themeVariables(this._config.theme);
    Object.entries(vars).forEach(([k, v]) => this.style.setProperty(k, v));
    this.keyMap = buildKeyMap(this._config.hotkeys);
    this.buildControls();
    this.els.bigPlay.hidden = !this._config.layout.centerPlay;
    if (this._core) this.render(this._core.state);
  }

  private buildControls(): void {
    this.controls.forEach((c) => c.destroy?.());
    this.controls = [];
    this.els.left.replaceChildren();
    this.els.right.replaceChildren();
    const ctx: ControlContext = { core: this._core as PlayerCore, config: this._config };
    const place = (ids: string[], target: HTMLElement): void => {
      ids.forEach((id) => {
        const factory = controlRegistry.get(id);
        if (!factory) {
          console.warn(`[MVPlayer] unknown control "${id}"`);
          return;
        }
        const control = factory(ctx);
        control.el.dataset.control = id;
        target.append(control.el);
        this.controls.push(control);
      });
    };
    place(this._config.layout.left, this.els.left);
    place(this._config.layout.right, this.els.right);
  }

  private restorePrefs(): void {
    const prefs = storage.loadPrefs();
    const b = this._config.behavior;
    if (b.rememberVolume) {
      if (typeof prefs.volume === 'number') this.video.volume = Math.min(1, Math.max(0, prefs.volume));
      if (typeof prefs.muted === 'boolean') this.video.muted = prefs.muted;
    }
    if (b.rememberSpeed && typeof prefs.rate === 'number') {
      this.video.defaultPlaybackRate = prefs.rate;
      this.video.playbackRate = prefs.rate;
    }
  }

  private render(s: PlaybackState): void {
    this.controls.forEach((c) => c.update(s));
    this.progress?.update(s);
    const showBig = this._config.layout.centerPlay && s.paused && !s.waiting && !s.error;
    this.els.bigPlay.hidden = !showBig;
    this.els.bigPlay.innerHTML = s.ended ? icons.replay : icons.play;
    this.els.spinner.hidden = !(s.waiting && !s.paused);
    this.els.error.hidden = !s.error;
    if (s.error) this.els.error.textContent = `Unable to play this video. ${s.error}`;
    // React to play/pause transitions only; timeupdate must not reset the idle timer.
    if (s.paused !== this.lastPaused) {
      this.lastPaused = s.paused;
      if (s.paused) this.wake();
      else this.scheduleIdle();
    }
    this.persistPrefs(s);
  }

  /** Remembers volume/mute and speed changes, whatever caused them (buttons, hotkeys). */
  private persistPrefs(s: PlaybackState): void {
    const b = this._config.behavior;
    const last = this.lastSaved;
    if (!last) return; // preferences are not restored yet
    if (b.rememberVolume && (s.volume !== last.volume || s.muted !== last.muted)) {
      storage.savePref('volume', s.volume);
      storage.savePref('muted', s.muted);
    }
    if (b.rememberSpeed && s.rate !== last.rate) storage.savePref('rate', s.rate);
    this.lastSaved = { volume: s.volume, muted: s.muted, rate: s.rate };
  }

  private wake = (): void => {
    this.removeAttribute('data-idle');
    this.scheduleIdle();
  };

  private scheduleIdle(delay?: number): void {
    window.clearTimeout(this.idleTimer);
    const layout = this._config?.layout;
    if (!layout?.autoHide || !this._core || this._core.video.paused) return;
    this.idleTimer = window.setTimeout(() => {
      const menuOpen = this.shadow.querySelector('.mv-menu:not([hidden])');
      if (!menuOpen && this._core && !this._core.video.paused) this.setAttribute('data-idle', '');
    }, delay ?? layout.autoHideDelay);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.composedPath()[0] as HTMLElement | undefined;
    // Let menus and the volume slider handle their own keys.
    if (target?.closest?.('.mv-menu') || (target instanceof HTMLInputElement && e.key.startsWith('Arrow'))) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const action = this.keyMap.get(key);
    if (!action || !this._core) return;
    // Space/Enter on a focused button should press that button, not toggle playback.
    if ((e.key === ' ' || e.key === 'Enter') && target instanceof HTMLButtonElement) return;
    e.preventDefault();
    runAction(action as Parameters<typeof runAction>[0], this._core, this._config);
    this.wake();
  };
}
