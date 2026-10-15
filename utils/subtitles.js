// Subtitle files uploaded by authors: SRT is converted to WebVTT, the result is checked.

const MAX_BYTES = 1024 * 1024; // 1 MB of text is far more than any subtitle file

/** Language tags offered in the upload form (code -> name shown to viewers). */
const LANGUAGES = {
  uk: 'Українська', en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano', pl: 'Polski',
};

const TIME = /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;

/** Converts SRT or WebVTT text to WebVTT and counts the cues. Returns { vtt, cues } or { error }. */
function toWebVtt(input) {
  let text = String(input || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { error: 'The file is empty.' };
  const isVtt = /^WEBVTT/.test(text);
  if (!isVtt) {
    // SRT: drop the cue numbers, use a dot as the decimal separator.
    text = text
      .split(/\n{2,}/)
      .map((block) => {
        const lines = block.split('\n');
        if (/^\d+$/.test(lines[0].trim()) && lines[1] && lines[1].includes('-->')) lines.shift();
        if (lines[0] && lines[0].includes('-->')) lines[0] = lines[0].replace(/(\d),(\d)/g, '$1.$2');
        return lines.join('\n');
      })
      .join('\n\n');
    text = `WEBVTT\n\n${text}`;
  }
  const cues = text.split('\n').filter((l) => l.includes('-->') && TIME.test(l.split('-->')[0]) && TIME.test(l.split('-->')[1] || '')).length;
  if (!cues) return { error: 'No subtitles found: upload a WebVTT (.vtt) or SubRip (.srt) file.' };
  return { vtt: `${text}\n`, cues };
}

module.exports = { toWebVtt, LANGUAGES, MAX_BYTES };
