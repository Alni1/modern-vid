import { isMasterPlaylist, parseMaster, parseMedia, type Level, type MediaPlaylist } from './m3u8';
import { ThroughputEstimator } from '../abr/ThroughputEstimator';
import { createAbr, maxAllowedLevel, type AbrAlgorithm, type AbrContext } from '../abr/algorithms';
import type { SourceContext, SourceHandler, StreamStats } from '../core/sources';

type MediaSourceCtor = typeof MediaSource;

function getMediaSourceCtor(): MediaSourceCtor | null {
  const w = window as unknown as { ManagedMediaSource?: MediaSourceCtor; MediaSource?: MediaSourceCtor };
  // ManagedMediaSource: Safari 17.1+ (including iPhone); MediaSource: everything else.
  return w.ManagedMediaSource ?? w.MediaSource ?? null;
}

function mimeOf(level: Level): string {
  return `video/mp4; codecs="${level.codecs || 'avc1.4d401f,mp4a.40.2'}"`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

class StaleError extends Error {}

/**
 * HLS engine on top of Media Source Extensions: loads playlists and fMP4 (CMAF)
 * segments, keeps the forward buffer filled, evicts old data and asks the ABR
 * module which quality level to load for every segment.
 */
export class HlsEngine implements SourceHandler {
  readonly name = 'hls';
  levels: Level[] = [];
  /** Level of the last appended segment. */
  currentLevel = -1;
  /** Index of the level chosen manually by the viewer, or −1 for automatic selection. */
  manualLevel = -1;
  native = false;

  /** Seconds of media to keep ahead of / behind the playhead. */
  maxBuffer = 30;
  backBuffer = 30;

  private video!: HTMLVideoElement;
  private ctx!: SourceContext;
  private ms: MediaSource | null = null;
  private sb: SourceBuffer | null = null;
  private objectUrl = '';
  private playlists: Array<MediaPlaylist | undefined> = [];
  private playlistLoads: Array<Promise<MediaPlaylist> | undefined> = [];
  private initLevel = -1;
  private loading = false;
  private generation = 0;
  private abort: AbortController | null = null;
  private timer = 0;
  private destroyed = false;
  /** Seconds of media loaded at the current level since the last switch. */
  private loadedSinceSwitch = 0;
  private failures = 0;
  readonly estimator: ThroughputEstimator;
  private abr: AbrAlgorithm;
  private abrId = '';

  constructor(initialThroughput = 0) {
    this.estimator = new ThroughputEstimator(initialThroughput);
    this.abr = createAbr('adaptive');
  }

  get isAuto(): boolean {
    return this.manualLevel < 0;
  }

  async attach(video: HTMLVideoElement, url: string, ctx: SourceContext): Promise<void> {
    this.video = video;
    this.ctx = ctx;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Playlist request failed: HTTP ${res.status}`);
    const text = await res.text();
    const base = res.url || url;
    if (isMasterPlaylist(text)) {
      this.levels = parseMaster(text, base);
    } else {
      this.levels = [{ index: 0, url: base, bitrate: 0, width: 0, height: 0, codecs: '', name: 'auto' }];
      this.playlists[0] = parseMedia(text, base);
    }

    const MS = getMediaSourceCtor();
    if (!MS || !MS.isTypeSupported(mimeOf(this.levels[0]))) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (older Safari): the browser does the streaming, our ABR is not used.
        this.native = true;
        video.src = url;
        ctx.emit('levels', []);
        return;
      }
      throw new Error('This browser supports neither Media Source Extensions nor native HLS');
    }

    this.ms = new MS();
    if (MS !== window.MediaSource) video.disableRemotePlayback = true; // required by ManagedMediaSource
    this.objectUrl = URL.createObjectURL(this.ms);
    video.src = this.objectUrl;
    await new Promise<void>((resolve) => this.ms!.addEventListener('sourceopen', () => resolve(), { once: true }));
    if (this.destroyed) return;

    const first = this.chooseLevel(0);
    const playlist = await this.loadPlaylist(first);
    this.ms.duration = playlist.totalDuration;
    this.sb = this.ms.addSourceBuffer(mimeOf(this.levels[first]));
    this.sb.mode = 'segments';

    ctx.emit('levels', this.levels);
    video.addEventListener('seeking', this.onSeeking);
    this.timer = window.setInterval(() => void this.tick(), 200);
    void this.tick();
  }

  /** Switches to a fixed level (−1 = automatic) and drops buffered data of the old quality. */
  setLevel(index: number): void {
    if (this.native) return;
    const next = index < 0 ? -1 : Math.min(index, this.levels.length - 1);
    if (next === this.manualLevel) return;
    this.manualLevel = next;
    if (next >= 0 && next !== this.currentLevel) void this.flushForward();
    this.ctx.emit('mode', { auto: next < 0, level: next });
  }

  stats(): StreamStats {
    const q = this.video?.getVideoPlaybackQuality?.();
    const level = this.levels[this.currentLevel];
    return {
      engine: this.native ? 'native-hls' : 'mse-hls',
      algorithm: this.abr.title,
      auto: this.isAuto,
      level: this.currentLevel,
      levelName: level?.name ?? '',
      bitrate: level?.bitrate ?? 0,
      resolution: level ? `${level.width}x${level.height}` : '',
      throughput: this.estimator.estimate,
      buffer: this.bufferAhead(),
      droppedFrames: q?.droppedVideoFrames ?? 0,
      totalFrames: q?.totalVideoFrames ?? 0,
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.generation++;
    window.clearInterval(this.timer);
    this.abort?.abort();
    this.video?.removeEventListener('seeking', this.onSeeking);
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    if (this.video) {
      this.video.removeAttribute('src');
      this.video.load();
    }
  }

  // ---------------------------------------------------------------- internals

  private onSeeking = (): void => {
    // Drop the download for the old position; data already buffered stays usable.
    this.generation++;
    this.abort?.abort();
    this.loading = false;
    void this.tick();
  };

  /** End of the buffered range that contains `t` (or `t` itself when nothing is buffered there). */
  private bufferedEndAt(t: number): number {
    const b = this.video.buffered;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) - 0.3 <= t && t <= b.end(i) + 0.1) return b.end(i);
    }
    return t;
  }

  private bufferAhead(): number {
    if (!this.video) return 0;
    const t = this.video.currentTime;
    return Math.max(0, this.bufferedEndAt(t) - t);
  }

  private referencePlaylist(): MediaPlaylist | undefined {
    return this.playlists[this.currentLevel] ?? this.playlists.find(Boolean);
  }

  private chooseLevel(segmentIndex: number): number {
    if (this.manualLevel >= 0) return this.manualLevel;
    const settings = this.ctx.abr();
    if (settings.algorithm !== this.abrId) {
      this.abr = createAbr(settings.algorithm);
      this.abrId = settings.algorithm;
    }
    const ref = this.referencePlaylist();
    const ctx: AbrContext = {
      levels: this.levels,
      currentLevel: this.currentLevel,
      throughput: this.estimator.estimate,
      buffer: this.bufferAhead(),
      maxBuffer: this.maxBuffer,
      segmentDuration: ref?.segments[segmentIndex]?.duration ?? ref?.targetDuration ?? 4,
      sinceSwitch: this.loadedSinceSwitch,
      maxAllowed: maxAllowedLevel(this.levels, settings.maxHeight, settings.mode),
      mode: settings.mode,
    };
    let level = this.abr.chooseLevel(ctx);
    // After repeated download failures, step down regardless of the algorithm.
    if (this.failures > 0) level = Math.max(0, Math.min(level, this.currentLevel - this.failures));
    return Math.max(0, Math.min(level, this.levels.length - 1));
  }

  private loadPlaylist(level: number): Promise<MediaPlaylist> {
    const ready = this.playlists[level];
    if (ready) return Promise.resolve(ready);
    let p = this.playlistLoads[level];
    if (!p) {
      p = this.fetchWithRetry(this.levels[level].url, 'text').then(({ data, url }) => {
        const pl = parseMedia(data as string, url);
        this.playlists[level] = pl;
        return pl;
      });
      p.catch(() => (this.playlistLoads[level] = undefined));
      this.playlistLoads[level] = p;
    }
    return p;
  }

  private async fetchWithRetry(url: string, as: 'text' | 'buffer', gen = this.generation) {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (gen !== this.generation || this.destroyed) throw new StaleError();
      this.abort = new AbortController();
      const started = performance.now();
      try {
        const res = await fetch(url, { signal: this.abort.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const data = as === 'text' ? await res.text() : await res.arrayBuffer();
        return { data, url: res.url || url, seconds: (performance.now() - started) / 1000 };
      } catch (err) {
        if ((err as Error).name === 'AbortError' || gen !== this.generation) throw new StaleError();
        lastErr = err;
        await sleep(500 * 2 ** attempt); // exponential back-off
      }
    }
    throw lastErr;
  }

  private append(data: ArrayBuffer): Promise<void> {
    const sb = this.sb!;
    return new Promise((resolve, reject) => {
      const done = (): void => {
        sb.removeEventListener('updateend', done);
        sb.removeEventListener('error', fail);
        resolve();
      };
      const fail = (): void => {
        sb.removeEventListener('updateend', done);
        sb.removeEventListener('error', fail);
        reject(new Error('SourceBuffer append error'));
      };
      sb.addEventListener('updateend', done);
      sb.addEventListener('error', fail);
      sb.appendBuffer(data);
    });
  }

  private remove(start: number, end: number): Promise<void> {
    const sb = this.sb!;
    if (end <= start) return Promise.resolve();
    return new Promise((resolve) => {
      sb.addEventListener('updateend', () => resolve(), { once: true });
      sb.remove(start, end);
    });
  }

  /** Appends with eviction of old data when the browser's buffer quota is exceeded. */
  private async appendSafe(data: ArrayBuffer): Promise<void> {
    try {
      await this.append(data);
    } catch (err) {
      if ((err as DOMException).name !== 'QuotaExceededError') throw err;
      const t = this.video.currentTime;
      await this.remove(0, Math.max(0, t - 5));
      this.maxBuffer = Math.max(10, this.maxBuffer * 0.7);
      await this.append(data);
    }
  }

  private async evictBackBuffer(): Promise<void> {
    const b = this.video.buffered;
    if (!b.length) return;
    const limit = this.video.currentTime - this.backBuffer;
    if (b.start(0) < limit - 1) await this.remove(0, limit);
  }

  private async flushForward(): Promise<void> {
    if (!this.sb || !this.ms) return;
    this.generation++;
    this.abort?.abort();
    while (this.sb.updating) await new Promise((r) => this.sb!.addEventListener('updateend', r, { once: true }));
    // Keep the segment being played and drop everything after it, so the new quality
    // starts exactly at a segment boundary (no gap between old and new data).
    const t = this.video.currentTime;
    const ref = this.referencePlaylist();
    const seg = ref?.segments.find((x) => t < x.start + x.duration);
    const from = seg ? seg.start + seg.duration : t + 1;
    if (from < this.ms.duration) await this.remove(from, this.ms.duration);
    this.loading = false;
    void this.tick();
  }

  /**
   * Jumps over small holes in the buffer (audio priming at the start, a few
   * milliseconds between segments of different qualities) the decoder would stall on.
   */
  private skipGap(): void {
    const v = this.video;
    if (v.seeking) return;
    const b = v.buffered;
    const t = v.currentTime;
    let inside = -1;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t && t < b.end(i)) inside = i;
    const stalled = v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
    for (let i = 0; i < b.length; i++) {
      const start = b.start(i);
      if (start <= t || start - t > 0.6) continue;
      // Either the playhead is outside any range, or it is stuck at the end of its range.
      if (inside < 0 || (stalled && b.end(inside) - t < 0.3)) {
        v.currentTime = start + 0.01;
        return;
      }
    }
  }

  private async tick(): Promise<void> {
    if (this.destroyed || this.loading || !this.sb || !this.ms || this.sb.updating) return;
    this.skipGap();
    const t = this.video.currentTime;
    const end = this.bufferedEndAt(t);
    if (end - t >= this.maxBuffer) return;

    const ref = this.referencePlaylist();
    if (!ref) return;
    const index = ref.segments.findIndex((s) => end < s.start + s.duration - 0.05);
    if (index < 0) {
      if (this.ms.readyState === 'open') {
        try {
          this.ms.endOfStream();
        } catch {
          /* already ended */
        }
      }
      return;
    }

    this.loading = true;
    const gen = this.generation;
    try {
      const level = this.chooseLevel(index);
      const playlist = await this.loadPlaylist(level);
      const segment = playlist.segments[index];
      if (!segment) return;

      if (this.initLevel !== level) {
        if (!playlist.initUrl) throw new Error('Playlist has no EXT-X-MAP initialization segment');
        const init = await this.fetchWithRetry(playlist.initUrl, 'buffer', gen);
        if (gen !== this.generation) return;
        const prev = this.levels[this.initLevel];
        if (prev && prev.codecs !== this.levels[level].codecs && 'changeType' in this.sb) {
          this.sb.changeType(mimeOf(this.levels[level]));
        }
        await this.appendSafe(init.data as ArrayBuffer);
        this.initLevel = level;
      }

      const res = await this.fetchWithRetry(segment.url, 'buffer', gen);
      if (gen !== this.generation) return;
      const bytes = (res.data as ArrayBuffer).byteLength;
      this.estimator.addSample(bytes, res.seconds);
      await this.evictBackBuffer();
      await this.appendSafe(res.data as ArrayBuffer);
      this.failures = 0;

      if (level !== this.currentLevel) {
        const from = this.currentLevel;
        this.currentLevel = level;
        this.loadedSinceSwitch = 0;
        this.ctx.emit('levelSwitch', { from, to: level, level: this.levels[level], auto: this.isAuto });
      }
      this.loadedSinceSwitch += segment.duration;
      this.ctx.emit('segment', {
        index, level, bytes, seconds: res.seconds, duration: segment.duration,
        throughput: this.estimator.estimate, buffer: this.bufferAhead(),
      });
    } catch (err) {
      if (err instanceof StaleError) return;
      this.failures++;
      console.warn('[MVPlayer] segment load failed', err);
      if (this.failures >= 3 && (this.currentLevel <= 0 || !this.isAuto)) {
        this.ctx.emit('error', (err as Error).message);
        window.clearInterval(this.timer);
      }
    } finally {
      this.loading = false;
    }
  }
}
