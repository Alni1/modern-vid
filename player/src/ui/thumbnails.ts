/** One preview frame: a region of a sprite sheet shown for a time range. */
export interface ThumbCue {
  start: number;
  end: number;
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function parseTime(t: string): number {
  const parts = t.trim().split(':').map(Number);
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}

/** Parses a WebVTT thumbnails track ("sprite.jpg#xywh=x,y,w,h" cues). URLs are resolved against the VTT URL. */
export function parseThumbsVtt(text: string, baseUrl: string): ThumbCue[] {
  const cues: ThumbCue[] = [];
  const blocks = text.replace(/\r/g, '').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const timing = lines.findIndex((l) => l.includes('-->'));
    if (timing < 0 || !lines[timing + 1]) continue;
    const [from, to] = lines[timing].split('-->');
    const [file, hash] = lines[timing + 1].trim().split('#');
    const m = /xywh=(\d+),(\d+),(\d+),(\d+)/.exec(hash ?? '');
    if (!m) continue;
    cues.push({
      start: parseTime(from),
      end: parseTime(to.trim().split(/\s+/)[0]),
      url: new URL(file, baseUrl).href,
      x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]),
    });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** Cue for a time (binary search over sorted cues). */
export function cueAt(cues: ThumbCue[], t: number): ThumbCue | null {
  let lo = 0;
  let hi = cues.length - 1;
  let found: ThumbCue | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      found = cues[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
