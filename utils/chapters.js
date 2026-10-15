// Chapters of a video entered by the author as text, one per line: "0:00 Introduction", "1:02:30 Summary".

const MAX_CHAPTERS = 100;
const MAX_TITLE = 100;

/** "1:02:30" or "12:05" -> seconds; NaN for anything else. */
function parseTime(value) {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return NaN;
  const [, h = '0', min, s] = m;
  if (Number(s) > 59 || (m[1] !== undefined && Number(min) > 59)) return NaN;
  return Number(h) * 3600 + Number(min) * 60 + Number(s);
}

/** Seconds -> "m:ss" or "h:mm:ss". */
function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * Parses the chapter list. Empty text means "no chapters". Rules: the first chapter starts at
 * 0:00, times grow, chapters are inside the video (when its duration is known).
 * Returns { chapters } or { error }.
 */
function parseChapters(text, duration = 0) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { chapters: [] };
  if (lines.length > MAX_CHAPTERS) return { error: `At most ${MAX_CHAPTERS} chapters.` };
  const chapters = [];
  for (const [i, line] of lines.entries()) {
    const m = /^(\S+)\s*[-–—]?\s+(.+)$/.exec(line);
    const start = m ? parseTime(m[1]) : NaN;
    if (!m || Number.isNaN(start)) return { error: `Line ${i + 1}: use the format "1:30 Chapter title".` };
    const title = m[2].trim().slice(0, MAX_TITLE);
    if (i === 0 && start !== 0) return { error: 'The first chapter must start at 0:00.' };
    if (i > 0 && start <= chapters[i - 1].start) return { error: `Line ${i + 1}: the chapters must go in time order.` };
    if (duration && start >= duration) return { error: `Line ${i + 1}: ${m[1]} is after the end of the video.` };
    chapters.push({ start, title });
  }
  return { chapters };
}

/** Chapters -> the text shown in the edit form. */
const chaptersToText = (chapters) => (chapters || []).map((c) => `${formatTime(c.start)} ${c.title}`).join('\n');

module.exports = { parseChapters, chaptersToText, parseTime, formatTime };
