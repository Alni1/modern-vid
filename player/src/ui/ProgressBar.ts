import type { PlayerCore, PlaybackState } from '../core/PlayerCore';
import { formatTime } from './format';
import { cueAt, parseThumbsVtt, type ThumbCue } from './thumbnails';

/** Seek bar with buffered range, hover tooltip with a preview frame, and pointer dragging. */
export class ProgressBar {
  readonly el: HTMLDivElement;
  private track: HTMLDivElement;
  private tooltip: HTMLDivElement;
  private preview_: HTMLDivElement;
  private previewImg: HTMLDivElement;
  private previewTime: HTMLDivElement;
  private dragging = false;
  private duration = 0;
  private thumbsUrl: string | null = null;
  private thumbs: ThumbCue[] | null = null;
  private thumbsLoading: Promise<void> | null = null;

  constructor(private core: PlayerCore) {
    this.el = document.createElement('div');
    this.el.className = 'mv-progress';
    this.el.setAttribute('role', 'slider');
    this.el.setAttribute('aria-label', 'Seek');
    this.el.tabIndex = 0;
    this.el.innerHTML =
      '<div class="mv-track"><div class="mv-buffered"></div><div class="mv-played"></div>' +
      '<div class="mv-thumb"></div></div><div class="mv-tooltip" hidden></div>' +
      '<div class="mv-preview" hidden aria-hidden="true"><div class="mv-preview-frame"><div class="mv-preview-img"></div></div>' +
      '<div class="mv-preview-time"></div></div>';
    this.track = this.el.querySelector('.mv-track') as HTMLDivElement;
    this.tooltip = this.el.querySelector('.mv-tooltip') as HTMLDivElement;
    this.preview_ = this.el.querySelector('.mv-preview') as HTMLDivElement;
    this.previewImg = this.el.querySelector('.mv-preview-img') as HTMLDivElement;
    this.previewTime = this.el.querySelector('.mv-preview-time') as HTMLDivElement;

    this.el.addEventListener('pointerdown', this.onDown);
    this.el.addEventListener('pointermove', this.onHover);
    this.el.addEventListener('pointerleave', () => {
      if (!this.dragging) this.hideTooltip();
    });
  }

  /** Sets the WebVTT track with preview frames (loaded on the first hover). */
  setThumbnails(url: string | null): void {
    if (url === this.thumbsUrl) return;
    this.thumbsUrl = url;
    this.thumbs = null;
    this.thumbsLoading = null;
  }

  private loadThumbs(): void {
    if (!this.thumbsUrl || this.thumbsLoading) return;
    const url = new URL(this.thumbsUrl, document.baseURI).href;
    this.thumbsLoading = fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => {
        if (url === new URL(this.thumbsUrl ?? '', document.baseURI).href) this.thumbs = parseThumbsVtt(text, url);
      })
      .catch((err) => console.warn('[MVPlayer] cannot load preview thumbnails', err));
  }

  private hideTooltip(): void {
    this.tooltip.hidden = true;
    this.preview_.hidden = true;
  }

  private ratioAt(clientX: number): number {
    const r = this.track.getBoundingClientRect();
    return r.width ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
  }

  private showTooltip(ratio: number): void {
    if (!this.duration) return;
    const time = ratio * this.duration;
    this.loadThumbs();
    const cue = this.thumbs ? cueAt(this.thumbs, time) : null;
    if (!cue) {
      this.preview_.hidden = true;
      this.tooltip.hidden = false;
      this.tooltip.textContent = formatTime(time);
      this.tooltip.style.left = `${ratio * 100}%`;
      return;
    }
    // Preview frame: about a fifth of the player width, between 120 and 240 px.
    const trackWidth = this.track.getBoundingClientRect().width;
    const width = Math.round(Math.min(240, Math.max(120, trackWidth * 0.2)));
    const scale = width / cue.w;
    const height = Math.round(cue.h * scale);
    this.tooltip.hidden = true;
    this.preview_.hidden = false;
    this.preview_.style.width = `${width}px`;
    const frame = this.preview_.firstElementChild as HTMLElement;
    frame.style.height = `${height}px`;
    const img = this.previewImg.style;
    img.width = `${cue.w}px`;
    img.height = `${cue.h}px`;
    img.backgroundImage = `url("${cue.url}")`;
    img.backgroundPosition = `-${cue.x}px -${cue.y}px`;
    img.transform = `scale(${scale})`;
    this.previewTime.textContent = formatTime(time);
    // Keep the preview inside the bar.
    const half = width / 2;
    const x = Math.min(trackWidth - half, Math.max(half, ratio * trackWidth));
    this.preview_.style.left = `${x}px`;
  }

  private onHover = (e: PointerEvent): void => {
    const ratio = this.ratioAt(e.clientX);
    this.showTooltip(ratio);
    if (this.dragging) this.preview(ratio);
  };

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.duration) return;
    this.dragging = true;
    this.el.classList.add('mv-dragging');
    this.el.setPointerCapture(e.pointerId);
    this.preview(this.ratioAt(e.clientX));
    const up = (ev: PointerEvent): void => {
      this.dragging = false;
      this.el.classList.remove('mv-dragging');
      this.core.seek(this.ratioAt(ev.clientX) * this.duration);
      this.el.removeEventListener('pointerup', up);
      this.el.removeEventListener('pointercancel', up);
    };
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
  };

  private preview(ratio: number): void {
    this.el.style.setProperty('--mv-played', `${ratio * 100}%`);
  }

  update(s: PlaybackState): void {
    this.duration = s.duration;
    const d = s.duration || 1;
    if (!this.dragging) this.el.style.setProperty('--mv-played', `${(s.currentTime / d) * 100}%`);
    this.el.style.setProperty('--mv-buffered', `${(s.bufferedEnd / d) * 100}%`);
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', String(Math.round(s.duration)));
    this.el.setAttribute('aria-valuenow', String(Math.round(s.currentTime)));
    this.el.setAttribute('aria-valuetext', `${formatTime(s.currentTime)} of ${formatTime(s.duration)}`);
  }
}
