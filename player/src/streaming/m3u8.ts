/** A rendition (quality level) from the HLS master playlist. */
export interface Level {
  index: number;
  url: string;
  /** Peak bitrate from BANDWIDTH, bits per second. */
  bitrate: number;
  width: number;
  height: number;
  codecs: string;
  name: string;
}

export interface Segment {
  index: number;
  url: string;
  start: number;
  duration: number;
}

export interface MediaPlaylist {
  initUrl: string | null;
  segments: Segment[];
  targetDuration: number;
  totalDuration: number;
}

function resolveUrl(uri: string, base: string): string {
  return new URL(uri, base).toString();
}

/** Parses `KEY=value,KEY2="quoted, value"` attribute lists. */
export function parseAttributes(list: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(list))) out[m[1]] = m[2].replace(/^"|"$/g, '');
  return out;
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export function isMasterPlaylist(text: string): boolean {
  return text.includes('#EXT-X-STREAM-INF');
}

/** Parses a master playlist; levels are sorted from the lowest to the highest bitrate. */
export function parseMaster(text: string, baseUrl: string): Level[] {
  const ls = lines(text);
  if (ls[0] !== '#EXTM3U') throw new Error('Not an M3U8 playlist');
  const levels: Omit<Level, 'index'>[] = [];
  for (let i = 0; i < ls.length; i++) {
    if (!ls[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrs = parseAttributes(ls[i].slice('#EXT-X-STREAM-INF:'.length));
    const uri = ls[i + 1];
    if (!uri || uri.startsWith('#')) continue;
    const [w, h] = (attrs.RESOLUTION || '0x0').split('x').map(Number);
    levels.push({
      url: resolveUrl(uri, baseUrl),
      bitrate: Number(attrs['AVERAGE-BANDWIDTH'] || attrs.BANDWIDTH) || 0,
      width: w || 0,
      height: h || 0,
      codecs: attrs.CODECS || '',
      name: h ? `${Math.min(w, h)}p` : uri,
    });
  }
  if (!levels.length) throw new Error('Master playlist has no variants');
  return levels.sort((a, b) => a.bitrate - b.bitrate).map((l, index) => ({ ...l, index }));
}

/** Parses a VOD media playlist with fMP4 segments. */
export function parseMedia(text: string, baseUrl: string): MediaPlaylist {
  const ls = lines(text);
  if (ls[0] !== '#EXTM3U') throw new Error('Not an M3U8 playlist');
  let initUrl: string | null = null;
  let targetDuration = 0;
  let pendingDuration: number | null = null;
  let start = 0;
  const segments: Segment[] = [];
  for (const l of ls) {
    if (l.startsWith('#EXT-X-TARGETDURATION:')) targetDuration = Number(l.split(':')[1]);
    else if (l.startsWith('#EXT-X-MAP:')) initUrl = resolveUrl(parseAttributes(l.slice(11)).URI, baseUrl);
    else if (l.startsWith('#EXTINF:')) pendingDuration = parseFloat(l.slice(8));
    else if (!l.startsWith('#') && pendingDuration !== null) {
      segments.push({ index: segments.length, url: resolveUrl(l, baseUrl), start, duration: pendingDuration });
      start += pendingDuration;
      pendingDuration = null;
    }
  }
  return { initUrl, segments, targetDuration, totalDuration: start };
}
