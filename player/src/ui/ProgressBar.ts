import type { PlayerCore, PlaybackState } from '../core/PlayerCore';
import { formatTime } from './format';

/** Seek bar with buffered range, hover tooltip and pointer dragging. */
export class ProgressBar {
  readonly el: HTMLDivElement;
  private track: HTMLDivElement;
  private tooltip: HTMLDivElement;
  private dragging = false;
  private duration = 0;

  constructor(private core: PlayerCore) {
    this.el = document.createElement('div');
    this.el.className = 'mv-progress';
    this.el.setAttribute('role', 'slider');
    this.el.setAttribute('aria-label', 'Seek');
    this.el.tabIndex = 0;
    this.el.innerHTML =
      '<div class="mv-track"><div class="mv-buffered"></div><div class="mv-played"></div>' +
      '<div class="mv-thumb"></div></div><div class="mv-tooltip" hidden></div>';
    this.track = this.el.querySelector('.mv-track') as HTMLDivElement;
    this.tooltip = this.el.querySelector('.mv-tooltip') as HTMLDivElement;

    this.el.addEventListener('pointerdown', this.onDown);
    this.el.addEventListener('pointermove', this.onHover);
    this.el.addEventListener('pointerleave', () => {
      if (!this.dragging) this.tooltip.hidden = true;
    });
  }

  private ratioAt(clientX: number): number {
    const r = this.track.getBoundingClientRect();
    return r.width ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
  }

  private showTooltip(ratio: number): void {
    if (!this.duration) return;
    this.tooltip.hidden = false;
    this.tooltip.textContent = formatTime(ratio * this.duration);
    this.tooltip.style.left = `${ratio * 100}%`;
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
