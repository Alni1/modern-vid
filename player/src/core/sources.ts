/**
 * A source handler attaches media to the <video> element.
 * Progressive playback is the first implementation; the HLS/MSE engine
 * will implement the same interface.
 */
export interface SourceHandler {
  readonly name: string;
  attach(video: HTMLVideoElement, url: string): void | Promise<void>;
  destroy(): void;
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

  destroy(): void {
    if (this.video) {
      this.video.removeAttribute('src');
      this.video.load();
      this.video = null;
    }
  }
}

export function pickSourceHandler(_url: string): SourceHandler {
  // HLS (.m3u8) handling will be added together with the streaming engine.
  return new ProgressiveSource();
}
