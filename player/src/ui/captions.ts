import type { SubtitlesConfig } from '../config/types';

/** One subtitle cue. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** A subtitle track offered by the page (attribute `subtitles`). */
export interface SubtitleTrack {
  lang: string;
  label: string;
  src: string;
}

/** "00:01:02.500", "01:02.500" or "01:02,500" (SRT) -> seconds. */
export function parseTimestamp(value: string): number {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim());
  if (!m) return NaN;
  const [, h = '0', min, s, ms] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

/**
 * Parses WebVTT (and SRT, which differs only in the header, cue numbers and the decimal comma).
 * Cue settings after the timestamps and NOTE/STYLE blocks are ignored; tags such as <i>
 * are removed, because the text is drawn with the viewer's own style.
 */
export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r/g, '').replace(/^﻿/, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [from, rest] = lines[at].split('-->');
    const start = parseTimestamp(from);
    const end = parseTimestamp(rest.trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const body = lines.slice(at + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** Cues active at `time` (overlapping cues are shown together). */
export function activeCues(cues: Cue[], time: number): Cue[] {
  return cues.filter((c) => c.start <= time && time < c.end);
}

const SIZES: Record<SubtitlesConfig['size'], string> = { small: '0.8', normal: '1', large: '1.3', xlarge: '1.65' };

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Draws the cues of the selected track over the video with the viewer's subtitle style. */
export class CaptionsView {
  readonly el: HTMLDivElement;
  private tracks: SubtitleTrack[] = [];
  private cache = new Map<string, Promise<Cue[]>>();
  private cues: Cue[] = [];
  private lang: string | null = null;
  private shown = '';

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'mv-cc-layer';
    this.el.setAttribute('aria-live', 'off');
  }

  setTracks(tracks: SubtitleTrack[]): void {
    this.tracks = tracks;
    if (this.lang && !tracks.some((t) => t.lang === this.lang)) this.select(null);
  }

  get available(): SubtitleTrack[] {
    return this.tracks;
  }

  get current(): string | null {
    return this.lang;
  }

  /** Shows the track in `lang` (null hides the subtitles). */
  select(lang: string | null): void {
    const track = lang ? this.tracks.find((t) => t.lang === lang) : undefined;
    this.lang = track ? track.lang : null;
    this.cues = [];
    this.render([]);
    if (!track) return;
    let p = this.cache.get(track.src);
    if (!p) {
      p = fetch(new URL(track.src, document.baseURI).href)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then(parseVtt);
      p.catch(() => this.cache.delete(track.src));
      this.cache.set(track.src, p);
    }
    p.then((cues) => {
      if (this.lang === track.lang) this.cues = cues;
    }).catch((err) => console.warn('[MVPlayer] cannot load subtitles', err));
  }

  /** Applies the viewer's subtitle style. */
  applyStyle(s: SubtitlesConfig): void {
    const st = this.el.style;
    st.setProperty('--mv-cc-scale', SIZES[s.size] ?? '1');
    st.setProperty('--mv-cc-color', s.color);
    st.setProperty('--mv-cc-bg', rgba(s.background, s.backgroundOpacity));
    st.setProperty('--mv-cc-shadow', s.edge === 'outline'
      ? '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000'
      : s.edge === 'shadow' ? '2px 2px 3px rgba(0,0,0,.9)' : 'none');
    this.el.dataset.position = s.position;
  }

  update(time: number): void {
    this.render(this.lang ? activeCues(this.cues, time) : []);
  }

  private render(cues: Cue[]): void {
    const key = cues.map((c) => c.start + c.text).join('|');
    if (key === this.shown) return;
    this.shown = key;
    this.el.replaceChildren(...cues.map((c) => {
      const line = document.createElement('span');
      line.className = 'mv-cue';
      line.textContent = c.text;
      return line;
    }));
  }
}
