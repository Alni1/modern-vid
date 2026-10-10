import { EventBus } from './EventBus';
import { pickSourceHandler, type SourceHandler } from './sources';

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

  async load(url: string): Promise<void> {
    this.source?.destroy();
    this.lastError = null;
    this.source = pickSourceHandler(url);
    await this.source.attach(this.video, url);
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
    this.bus.clear();
  }
}
