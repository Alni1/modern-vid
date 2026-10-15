/** A chapter of the video (attribute `chapters`: [{ "start": 0, "title": "Intro" }, ...]). */
export interface Chapter {
  start: number;
  title: string;
}

/** Validates the attribute value: chapters sorted by start time, titles non-empty. */
export function normalizeChapters(value: unknown): Chapter[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is Chapter => !!c && typeof c.start === 'number' && c.start >= 0 && typeof c.title === 'string' && c.title.trim() !== '')
    .map((c) => ({ start: c.start, title: c.title.trim() }))
    .sort((a, b) => a.start - b.start);
}

/** Index of the chapter that contains `time` (-1 before the first chapter or without chapters). */
export function chapterIndexAt(chapters: Chapter[], time: number): number {
  let found = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].start <= time) found = i;
    else break;
  }
  return found;
}
