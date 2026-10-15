const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseChapters, chaptersToText } = require('../utils/chapters');
const { toWebVtt } = require('../utils/subtitles');

test('chapters: parsing, order and the first chapter at 0:00', () => {
  const { chapters } = parseChapters('0:00 Intro\n1:30 - Part one\n1:02:03 Summary', 4000);
  assert.deepEqual(chapters, [{ start: 0, title: 'Intro' }, { start: 90, title: 'Part one' }, { start: 3723, title: 'Summary' }]);
  assert.equal(chaptersToText(chapters), '0:00 Intro\n1:30 Part one\n1:02:03 Summary');
  assert.deepEqual(parseChapters('').chapters, []);
  assert.match(parseChapters('0:10 Late start').error, /0:00/);
  assert.match(parseChapters('0:00 A\n2:00 B\n1:00 C').error, /time order/);
  assert.match(parseChapters('0:00 A\n5:00 B', 120).error, /after the end/);
  assert.match(parseChapters('0:00 A\nsomething').error, /format/);
});

test('subtitles: SRT is converted to WebVTT, invalid files are rejected', () => {
  const r = toWebVtt('1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nWorld');
  assert.equal(r.cues, 2);
  assert.equal(r.vtt, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello\n\n00:00:03.000 --> 00:00:04.000\nWorld\n');
  assert.equal(toWebVtt('WEBVTT\n\n00:01.000 --> 00:02.000\nHi').cues, 1);
  assert.ok(toWebVtt('just some text').error);
  assert.ok(toWebVtt('').error);
});
