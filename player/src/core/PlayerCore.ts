import { EventBus } from './EventBus';
import { pickSourceHandler, type AbrSettings, type SourceHandler, type StreamEvents, type StreamStats } from './sources';
import { QoeTracker } from './QoeTracker';
import type { Level } from '../streaming/m3u8';

export interface PlaybackState {
  paused: boolean;
  ended: boolean;
  waiting: boolean;
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  volume: number;
  muted: boolean;
  rate: number;
  fullscreen: boolean;
  pip: boolean;
  error: string | null;
}

export interface CoreEvents extends Record<string, unknown> {
  state: PlaybackState;
  ready: PlaybackState;
  error: string;
  /** Quality levels became known (empty for progressive playback). */
  levels: Level[];
  levelSwitch: StreamEvents['levelSwitch'];
  segment: StreamEvents['segment'];
  /** Automatic/manual quality selection changed. */
  qualityMode: StreamEvents['mode'];
}

export interface LoadOptions {
  /** Plain file to use when the adaptive stream cannot be played. */
  fallbackUrl?: string | null;
  /** Initial throughput estimate (bits/s) from the previous session — "warm start". */
  initialThroughput?: number;
}

const MEDIA_EVENTS = [
  'play', 'pause', 'playing', 'waiting', 'canplay', 'seeking', 'seeked', 'ended',
  'timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'volumechange',
  'ratechange', 'enterpictureinpicture', 'leavepictureinpicture',
] as const;

/**
 * Player core: owns the <video> element and the playback state,
 * and notifies other modules through the event bus.
 */
export class PlayerCore {
  readonly bus = new EventBus<CoreEvents>();
  readonly video: HTMLVideoElement;
  private source: SourceHandler | null = null;
  readonly qoe: QoeTracker;
  /** Provider of the current ABR settings (set by the element from its configuration). */
  abrSettings: () => AbrSettings = () => ({ algorithm: 'adaptive', mode: 'balanced', maxHeight: null });
  private fullscreenTarget: HTMLElement;
  private waiting = false;
  private lastError: string | null = null;
  private onMediaEvent = (e: Event): void => {
    if (e.type === 'waiting') this.waiting = true;
    if (e.type === 'playing' || e.type === 'canplay' || e.type === 'pause') this.waiting = false;
    if (e.type === 'loadedmetadata') this.bus.emit('ready', this.state);
    this.bus.emit('state', this.state);
  };
  private onError = (): void => {
    const err = this.video.error;
    this.lastError = err ? `Media error ${err.code}${err.message ? `: ${err.message}` : ''}` : 'Unknown error';
    this.bus.emit('error', this.lastError);
    this.bus.emit('state', this.state);
  };
  private onFullscreenChange = (): void => this.bus.emit('state', this.state);

  constructor(video: HTMLVideoElement, fullscreenTarget: HTMLElement) {
    this.video = video;
    this.fullscreenTarget = fullscreenTarget;
    this.qoe = new QoeTracker(video);
    MEDIA_EVENTS.forEach((ev) => video.addEventListener(ev, this.onMediaEvent));
    video.addEventListener('error', this.onError);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
  }

  get state(): PlaybackState {
    const v = this.video;
    let bufferedEnd = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime + 0.5) bufferedEnd = Math.max(bufferedEnd, v.buffered.end(i));
    }
    return {
      paused: v.paused,
      ended: v.ended,
      waiting: this.waiting,
      currentTime: v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
      bufferedEnd,
      volume: v.volume,
      muted: v.muted,
      rate: v.playbackRate,
      fullscreen: document.fullscreenElement === this.fullscreenTarget,
      pip: document.pictureInPictureElement === v,
      error: this.lastError,
    };
  }

  async load(url: string, options: LoadOptions = {}): Promise<void> {
    this.source?.destroy();
    this.lastError = null;
    const source = pickSourceHandler(url, options.initialThroughput);
    this.source = source;
    const ctx = {
      emit: <K extends keyof StreamEvents>(event: K, payload: StreamEvents[K]): void => {
        if (this.source !== source) return; // events of a replaced source
        if (event === 'levels') this.qoe.setLevels(payload as Level[]);
        if (event === 'levelSwitch') {
          const p = payload as StreamEvents['levelSwitch'];
          this.qoe.onLevelSwitch(p.to, p.from);
        }
        if (event === 'segment') this.qoe.onSegment((payload as StreamEvents['segment']).level);
        if (event === 'error') {
          this.lastError = payload as string;
          this.bus.emit('error', this.lastError);
          this.bus.emit('state', this.state);
          return;
        }
        this.bus.emit(event === 'mode' ? 'qualityMode' : event, payload as never);
      },
      abr: () => this.abrSettings(),
    };
    try {
      await source.attach(this.video, url, ctx);
    } catch (err) {
      if (this.source !== source) return;
      console.warn('[MVPlayer] adaptive stream failed, falling back', err);
      source.destroy();
      if (!options.fallbackUrl) throw err;
      this.source = pickSourceHandler(options.fallbackUrl);
      await this.source.attach(this.video, options.fallbackUrl, ctx);
      this.bus.emit('levels', []);
    }
  }

  /** Quality levels of the adaptive stream (empty for progressive playback). */
  get levels(): Level[] {
    return this.source?.levels ?? [];
  }

  get currentLevel(): number {
    return this.source?.currentLevel ?? -1;
  }

  get autoQuality(): boolean {
    return this.source?.isAuto ?? true;
  }

  /** Selects a fixed quality level, or −1 for automatic selection. */
  setLevel(index: number): void {
    this.source?.setLevel?.(index);
  }

  stats(): StreamStats | null {
    return this.source?.stats?.() ?? null;
  }

  /** Current throughput estimate, used to warm-start the next session. */
  get throughput(): number {
    return this.source?.stats?.().throughput ?? 0;
  }

  play(): Promise<void> {
    return this.video.play().catch((err: unknown) => {
      // Autoplay restrictions are expected; anything else is reported.
      if (err instanceof DOMException && err.name === 'NotAllowedError') return;
      console.warn('[MVPlayer] play() failed', err);
    });
  }

  pause(): void {
    this.video.pause();
  }

  togglePlay(): void {
    if (this.video.paused || this.video.ended) void this.play();
    else this.pause();
  }

  seek(time: number): void {
    const d = this.state.duration;
    this.video.currentTime = Math.max(0, d ? Math.min(time, d) : time);
  }

  seekBy(delta: number): void {
    this.seek(this.video.currentTime + delta);
  }

  setVolume(volume: number): void {
    this.video.volume = Math.min(1, Math.max(0, volume));
    if (this.video.volume > 0 && this.video.muted) this.video.muted = false;
  }

  setMuted(muted: boolean): void {
    this.video.muted = muted;
  }

  setRate(rate: number): void {
    this.video.playbackRate = rate;
  }

  async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.fullscreenTarget.requestFullscreen();
    } catch (err) {
      console.warn('[MVPlayer] fullscreen failed', err);
    }
  }

  async togglePip(): Promise<void> {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await this.video.requestPictureInPicture();
    } catch (err) {
      console.warn('[MVPlayer] picture-in-picture failed', err);
    }
  }

  destroy(): void {
    MEDIA_EVENTS.forEach((ev) => this.video.removeEventListener(ev, this.onMediaEvent));
    this.video.removeEventListener('error', this.onError);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.source?.destroy();
    this.qoe.destroy();
    this.bus.clear();
  }
}
