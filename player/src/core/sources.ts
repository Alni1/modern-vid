import type { Level } from '../streaming/m3u8';
import type { AbrAlgorithmId, AbrMode } from '../abr/algorithms';
import { HlsEngine } from '../streaming/HlsEngine';

export interface AbrSettings {
  algorithm: AbrAlgorithmId;
  mode: AbrMode;
  maxHeight: number | null;
}

export interface StreamStats {
  engine: string;
  algorithm: string;
  auto: boolean;
  level: number;
  levelName: string;
  bitrate: number;
  resolution: string;
  throughput: number;
  buffer: number;
  droppedFrames: number;
  totalFrames: number;
}

/** Events a source handler reports to the player core. */
export interface StreamEvents {
  levels: Level[];
  levelSwitch: { from: number; to: number; level: Level; auto: boolean };
  segment: { index: number; level: number; bytes: number; seconds: number; duration: number; throughput: number; buffer: number };
  mode: { auto: boolean; level: number };
  error: string;
}

export interface SourceContext {
  emit<K extends keyof StreamEvents>(event: K, payload: StreamEvents[K]): void;
  /** Current ABR settings (read on every decision, so changes apply immediately). */
  abr(): AbrSettings;
}

/**
 * A source handler attaches media to the <video> element:
 * progressive playback of a plain file, or the HLS engine with adaptive quality.
 */
export interface SourceHandler {
  readonly name: string;
  attach(video: HTMLVideoElement, url: string, ctx: SourceContext): void | Promise<void>;
  destroy(): void;
  levels?: Level[];
  currentLevel?: number;
  readonly isAuto?: boolean;
  setLevel?(index: number): void;
  stats?(): StreamStats;
}

/** Plain file playback (MP4/WebM) via the native src attribute. */
export class ProgressiveSource implements SourceHandler {
  readonly name = 'progressive';
  private video: HTMLVideoElement | null = null;

  attach(video: HTMLVideoElement, url: string): void {
    this.video = video;
    video.src = url;
    video.load();
  }

  stats(): StreamStats {
    const q = this.video?.getVideoPlaybackQuality?.();
    const v = this.video;
    return {
      engine: 'progressive', algorithm: '—', auto: false, level: -1, levelName: 'source', bitrate: 0,
      resolution: v ? `${v.videoWidth}x${v.videoHeight}` : '', throughput: 0, buffer: 0,
      droppedFrames: q?.droppedVideoFrames ?? 0, totalFrames: q?.totalVideoFrames ?? 0,
    };
  }

  destroy(): void {
    if (this.video) {
      this.video.removeAttribute('src');
      this.video.load();
      this.video = null;
    }
  }
}

export function isHlsUrl(url: string): boolean {
  return /\.m3u8($|\?)/i.test(url);
}

export function pickSourceHandler(url: string, initialThroughput = 0): SourceHandler {
  return isHlsUrl(url) ? new HlsEngine(initialThroughput) : new ProgressiveSource();
}
