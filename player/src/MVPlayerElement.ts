import { PlayerCore, type PlaybackState } from './core/PlayerCore';
import { resolveConfig } from './config/merge';
import type { AuthorPreset, PlayerConfig, ViewerPreset } from './config/types';
import { controlRegistry, type Control, type ControlContext } from './ui/controls';
import { ProgressBar } from './ui/ProgressBar';
import { SettingsPanel } from './ui/SettingsPanel';
import { PLAYER_CSS, themeVariables } from './ui/styles';
import { icons } from './ui/icons';
import { buildKeyMap, runAction } from './hotkeys';
import { storage } from './storage';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Returns a copy of `obj` with `value` written at `path` (undefined removes the key and empty parents). */
function withPath(obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const [key, ...rest] = path;
  const out = { ...obj };
  if (rest.length === 0) {
    if (value === undefined) delete out[key];
    else out[key] = value;
    return out;
  }
  const child = withPath(isPlainObject(out[key]) ? (out[key] as Record<string, unknown>) : {}, rest, value);
  if (Object.keys(child).length) out[key] = child;
  else delete out[key];
  return out;
}

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
 *  - src           media URL: HLS master playlist (.m3u8) or a plain MP4/WebM file
 *  - fallback-src  plain file used when the adaptive stream cannot be played
 *  - poster        poster image URL
 *  - author-theme  JSON with the channel author's theme (appearance only)
 *  - preset        JSON with the viewer's saved preset (from the server);
 *                  when absent or empty the preset stored in the browser is used
 *  - preview       boolean: preview mode (e.g. the channel theme editor) — the viewer's
 *                  stored settings are neither applied nor changed
 *
 * Events:
 *  - mv-ready          metadata loaded
 *  - mv-preset-change  the viewer changed a setting; detail.preset is the new viewer preset
 *                      (the page can save it on the server)
 */
export class MVPlayerElement extends HTMLElement {
  static observedAttributes = ['src', 'fallback-src', 'poster', 'author-theme', 'preset'];

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
    stats: HTMLDivElement;
  };
  private settings!: SettingsPanel;
  private keyMap = new Map<string, string>();
  private statsTimer = 0;
  private lastThroughputSave = 0;
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
    window.clearInterval(this.statsTimer);
    if (this._core) storage.saveThroughput(this._core.throughput);
  }

  attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void {
    if (!this.built || oldValue === value) return;
    if (name === 'src' && value) void this.loadSource(value);
    if (name === 'poster') this.video.poster = value ?? '';
    if (name === 'preset') {
      const p = parseJson<ViewerPreset>(value);
      if (p && Object.keys(p).length) this.setViewerPreset(p);
      return;
    }
    if (name === 'author-theme') {
      this.applyConfig();
      this.settings.render();
    }
  }

  /** Applies a viewer preset immediately and stores it in the browser. */
  setViewerPreset(preset: ViewerPreset, persist = true): void {
    this.viewerPreset = preset;
    if (persist) storage.savePreset(preset);
    this.applyConfig();
    this.settings?.render();
  }

  /** The viewer's own settings (only the values that differ from the defaults). */
  getViewerPreset(): ViewerPreset {
    return this.viewerPreset ?? {};
  }

  /** Opens or closes the settings panel. */
  toggleSettings(force?: boolean): void {
    if (force === true) this.settings.open();
    else if (force === false) this.settings.close();
    else this.settings.toggle();
  }

  /** Changes one viewer setting, applies it and notifies the page. */
  private updatePreset(preset: ViewerPreset): void {
    this.viewerPreset = preset;
    if (this.hasAttribute('preview')) {
      this.applyConfig();
      return;
    }
    storage.savePreset(preset);
    this.applyConfig();
    this.dispatchEvent(new CustomEvent('mv-preset-change', { detail: { preset }, bubbles: true }));
  }

  /** QoE metrics of the current session (startup time, stalls, switches, bitrate, QoE score). */
  qoe() {
    return this._core?.qoe.snapshot() ?? null;
  }

  /** Shows or hides the technical statistics panel ("Stats for nerds"). */
  toggleStats(force?: boolean): void {
    const show = force ?? this.els.stats.hidden;
    this.els.stats.hidden = !show;
    window.clearInterval(this.statsTimer);
    if (show) {
      this.renderStats();
      this.statsTimer = window.setInterval(() => this.renderStats(), 500);
    }
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
    const stats = document.createElement('div');
    stats.className = 'mv-stats';
    stats.hidden = true;

    const controls = document.createElement('div');
    controls.className = 'mv-controls';
    controls.innerHTML =
      '<div class="mv-progress-slot"></div>' +
      '<div class="mv-bar"><div class="mv-group mv-left"></div><div class="mv-group mv-right"></div></div>';

    this.settings = new SettingsPanel({
      config: () => this._config,
      preset: () => this.getViewerPreset(),
      hasAuthorTheme: () => Boolean(parseJson<AuthorPreset['theme']>(this.getAttribute('author-theme'))),
      set: (path, value) => this.updatePreset(withPath(this.getViewerPreset() as Record<string, unknown>, path, value) as ViewerPreset),
      replacePreset: (preset) => this.updatePreset(preset),
      onToggle: (open) => {
        if (this._core) this.render(this._core.state);
        if (open) this.wake();
        else this.focus();
      },
    });

    this.shadow.append(style, this.video, overlay, error, stats, controls, this.settings.el);
    this.els = {
      bar: controls.querySelector('.mv-bar') as HTMLDivElement,
      left: controls.querySelector('.mv-left') as HTMLDivElement,
      right: controls.querySelector('.mv-right') as HTMLDivElement,
      bigPlay: overlay.querySelector('.mv-big-play') as HTMLButtonElement,
      spinner: overlay.querySelector('.mv-spinner') as HTMLDivElement,
      error,
      progressSlot: controls.querySelector('.mv-progress-slot') as HTMLDivElement,
      stats,
    };

    const core = new PlayerCore(this.video, this);
    this._core = core;
    core.abrSettings = () => this._config.quality;
    core.bus.on('segment', () => {
      // Remember the network speed for a "warm start" of the next session (at most every 10 s).
      if (performance.now() - this.lastThroughputSave > 10_000) {
        this.lastThroughputSave = performance.now();
        storage.saveThroughput(core.throughput);
      }
    });
    this.progress = new ProgressBar(core);
    this.els.progressSlot.append(this.progress.el);

    // A preset from the server (signed-in viewer) wins; otherwise the one saved in this browser.
    const serverPreset = parseJson<ViewerPreset>(this.getAttribute('preset'));
    const localPreset = storage.loadPreset();
    if (this.hasAttribute('preview')) {
      this.viewerPreset = {};
    } else if (serverPreset && Object.keys(serverPreset).length) {
      this.viewerPreset = serverPreset;
      storage.savePreset(serverPreset);
    } else {
      this.viewerPreset = localPreset;
      // Signed in for the first time with local settings: let the page upload them.
      if (this.hasAttribute('preset') && localPreset && Object.keys(localPreset).length) {
        queueMicrotask(() => this.dispatchEvent(new CustomEvent('mv-preset-change', { detail: { preset: localPreset }, bubbles: true })));
      }
    }
    this.applyConfig();
    this.restorePrefs();
    this.lastSaved = { volume: this.video.volume, muted: this.video.muted, rate: this.video.playbackRate };

    core.bus.on('state', (s) => this.render(s));
    core.bus.on('ready', (s) => {
      this.render(s);
      this.dispatchEvent(new CustomEvent('mv-ready', { detail: s }));
    });

    overlay.addEventListener('click', (e) => {
      if (this.settings.isOpen) {
        this.settings.close();
        return;
      }
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
    if (src) void this.loadSource(src).then(() => {
      if (this._config.behavior.autoplay) void core.play();
    });
    this.render(core.state);
  }

  private async loadSource(url: string): Promise<void> {
    if (!this._core) return;
    try {
      await this._core.load(url, {
        fallbackUrl: this.getAttribute('fallback-src'),
        initialThroughput: storage.loadThroughput(),
      });
    } catch (err) {
      console.error('[MVPlayer] cannot load media', err);
    }
  }

  private renderStats(): void {
    const core = this._core;
    if (!core) return;
    const st = core.stats();
    const q = core.qoe.snapshot();
    const mbps = (bps: number): string => (bps ? `${(bps / 1e6).toFixed(2)} Mbit/s` : '—');
    const rows: Array<[string, string]> = [
      ['Engine', st?.engine ?? '—'],
      ['ABR algorithm', st && st.level >= 0 ? `${st.algorithm}${st.auto ? '' : ' (manual)'}` : '—'],
      ['Quality', st?.levelName ? `${st.levelName} (${st.resolution})` : st?.resolution ?? '—'],
      ['Bitrate', mbps(st?.bitrate ?? 0)],
      ['Throughput', mbps(st?.throughput ?? 0)],
      ['Buffer', `${(st?.buffer ?? 0).toFixed(1)} s`],
      ['Dropped frames', `${st?.droppedFrames ?? 0} / ${st?.totalFrames ?? 0}`],
      ['Startup time', q.startupTime !== null ? `${q.startupTime.toFixed(2)} s` : '—'],
      ['Stalls', `${q.rebufferCount} (${q.rebufferTime.toFixed(1)} s)`],
      ['Quality switches', String(q.switches)],
    ];
    const table = document.createElement('table');
    rows.forEach(([k, v]) => {
      const tr = table.insertRow();
      tr.insertCell().textContent = k;
      tr.insertCell().textContent = v;
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mv-stats-close';
    close.setAttribute('aria-label', 'Close statistics');
    close.textContent = '×';
    close.addEventListener('click', () => this.toggleStats(false));
    this.els.stats.replaceChildren(close, table);
  }

  /** Re-resolves the configuration and rebuilds theme, layout and hotkeys. */
  private applyConfig(): void {
    const author = parseJson<AuthorPreset>(this.getAttribute('author-theme'));
    this._config = resolveConfig(author ? { theme: author as AuthorPreset['theme'] } : null, this.viewerPreset);
    // The settings button cannot be removed in the panel; presets saved before it existed get it back.
    const { left, right } = this._config.layout;
    if (!left.includes('settings') && !right.includes('settings')) {
      const at = right.indexOf('fullscreen');
      this._config.layout.right = at >= 0 ? [...right.slice(0, at), 'settings', ...right.slice(at)] : [...right, 'settings'];
    }
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
    const ctx: ControlContext = {
      core: this._core as PlayerCore,
      config: this._config,
      ui: { toggleSettings: () => this.toggleSettings(), settingsOpen: () => this.settings.isOpen },
    };
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
      const menuOpen = this.shadow.querySelector('.mv-menu:not([hidden]), .mv-settings:not([hidden])');
      if (!menuOpen && this._core && !this._core.video.paused) this.setAttribute('data-idle', '');
    }, delay ?? layout.autoHideDelay);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.composedPath()[0] as HTMLElement | undefined;
    // Let menus, the settings panel and the volume slider handle their own keys.
    if (target?.closest?.('.mv-menu, .mv-settings') || (target instanceof HTMLInputElement && e.key.startsWith('Arrow'))) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const action = this.keyMap.get(key);
    if (!action || !this._core) return;
    // Space/Enter on a focused button should press that button, not toggle playback.
    if ((e.key === ' ' || e.key === 'Enter') && target instanceof HTMLButtonElement) return;
    e.preventDefault();
    runAction(action as Parameters<typeof runAction>[0], this._core, this._config, this);
    this.wake();
  };
}
