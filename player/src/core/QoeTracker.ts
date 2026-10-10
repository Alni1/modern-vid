import type { Level } from '../streaming/m3u8';

export interface QoeSnapshot {
  /** Seconds from the first play request to the first rendered frame. */
  startupTime: number | null;
  /** Number of stalls during playback (not caused by seeking). */
  rebufferCount: number;
  /** Total stall duration, seconds. */
  rebufferTime: number;
  /** Share of the session spent stalled: T_reb / (T_play + T_reb). */
  rebufferRatio: number;
  /** Number of quality switches. */
  switches: number;
  /** Playback-time-weighted average bitrate, bits per second. */
  avgBitrate: number;
  /** Seconds of media actually played. */
  playTime: number;
  /** Integral QoE, formula (1.2) with q(R) = ln(R / R_min). */
  qoe: number;
  /** Per-segment log used by the experiments. */
  segments: Array<{ level: number; bitrate: number }>;
}

/**
 * Collects Quality of Experience metrics of a playback session from <video> events
 * and the streaming engine. Used by the stats panel, telemetry and ABR experiments.
 */
export class QoeTracker {
  private playRequestedAt: number | null = null;
  private startupTime: number | null = null;
  private stallStart: number | null = null;
  private rebufferCount = 0;
  private rebufferTime = 0;
  private seeking = false;
  private switches = 0;
  private lastTime = 0;
  private playTime = 0;
  private bitrateTime = 0;
  private levels: Level[] = [];
  private level = -1;
  private segments: Array<{ level: number; bitrate: number }> = [];

  constructor(private video: HTMLVideoElement) {
    video.addEventListener('play', this.onPlay);
    video.addEventListener('playing', this.onPlaying);
    video.addEventListener('waiting', this.onWaiting);
    video.addEventListener('seeking', this.onSeeking);
    video.addEventListener('seeked', this.onSeeked);
    video.addEventListener('timeupdate', this.onTimeUpdate);
  }

  setLevels(levels: Level[]): void {
    this.levels = levels;
  }

  onLevelSwitch(to: number, from: number): void {
    if (from >= 0 && to !== from) this.switches++;
    this.level = to;
  }

  onSegment(level: number): void {
    this.segments.push({ level, bitrate: this.levels[level]?.bitrate ?? 0 });
  }

  private now(): number {
    return performance.now() / 1000;
  }

  private onPlay = (): void => {
    if (this.playRequestedAt === null) this.playRequestedAt = this.now();
  };

  private onPlaying = (): void => {
    if (this.startupTime === null && this.playRequestedAt !== null) {
      this.startupTime = this.now() - this.playRequestedAt;
    }
    if (this.stallStart !== null) {
      this.rebufferTime += this.now() - this.stallStart;
      this.stallStart = null;
    }
    this.lastTime = this.video.currentTime;
  };

  private onWaiting = (): void => {
    // A stall counts only after playback started and when it is not caused by a seek.
    if (this.startupTime === null || this.seeking || this.stallStart !== null) return;
    this.stallStart = this.now();
    this.rebufferCount++;
  };

  private onSeeking = (): void => {
    this.seeking = true;
    if (this.stallStart !== null) {
      this.rebufferTime += this.now() - this.stallStart;
      this.stallStart = null;
    }
  };

  private onSeeked = (): void => {
    this.seeking = false;
    this.lastTime = this.video.currentTime;
  };

  private onTimeUpdate = (): void => {
    const t = this.video.currentTime;
    const dt = t - this.lastTime;
    this.lastTime = t;
    if (this.seeking || dt <= 0 || dt > 2) return; // ignore jumps
    this.playTime += dt;
    const bitrate = this.levels[this.level]?.bitrate ?? 0;
    this.bitrateTime += dt * bitrate;
  };

  snapshot(): QoeSnapshot {
    const stalled = this.stallStart !== null ? this.now() - this.stallStart : 0;
    const rebufferTime = this.rebufferTime + stalled;
    const rMin = this.levels[0]?.bitrate || 1;
    const rMax = this.levels[this.levels.length - 1]?.bitrate || rMin;
    const q = (r: number): number => (r > 0 ? Math.log(r / rMin) : 0);
    // Weights as in Yin et al.: λ = 1, μ = μ_s = q(R_max) (one second of stall costs a top-quality segment).
    const mu = Math.max(1, q(rMax));
    let quality = 0;
    let smoothness = 0;
    this.segments.forEach((s, i) => {
      quality += q(s.bitrate);
      if (i > 0) smoothness += Math.abs(q(s.bitrate) - q(this.segments[i - 1].bitrate));
    });
    const startup = this.startupTime ?? 0;
    return {
      startupTime: this.startupTime,
      rebufferCount: this.rebufferCount,
      rebufferTime,
      rebufferRatio: this.playTime + rebufferTime > 0 ? rebufferTime / (this.playTime + rebufferTime) : 0,
      switches: this.switches,
      avgBitrate: this.playTime > 0 ? this.bitrateTime / this.playTime : 0,
      playTime: this.playTime,
      qoe: quality - smoothness - mu * rebufferTime - mu * startup,
      segments: [...this.segments],
    };
  }

  destroy(): void {
    this.video.removeEventListener('play', this.onPlay);
    this.video.removeEventListener('playing', this.onPlaying);
    this.video.removeEventListener('waiting', this.onWaiting);
    this.video.removeEventListener('seeking', this.onSeeking);
    this.video.removeEventListener('seeked', this.onSeeked);
    this.video.removeEventListener('timeupdate', this.onTimeUpdate);
  }
}
