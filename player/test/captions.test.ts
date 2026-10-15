import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeCues, parseTimestamp, parseVtt } from '../src/ui/captions';
import { chapterIndexAt, normalizeChapters } from '../src/ui/chapters';

test('WebVTT and SRT cues are parsed; tags and cue settings are ignored', () => {
  assert.equal(parseTimestamp('01:02:03.5'), 3723.5);
  assert.equal(parseTimestamp('00:04,250'), 4.25);
  const cues = parseVtt('WEBVTT\n\nNOTE comment\n\n1\n00:00:01.000 --> 00:00:03.000 align:start\n<i>Hello</i>\nworld\n\n00:00:02.500 --> 00:00:04.000\nSecond');
  assert.deepEqual(cues, [{ start: 1, end: 3, text: 'Hello\nworld' }, { start: 2.5, end: 4, text: 'Second' }]);
  assert.equal(activeCues(cues, 2.7).length, 2);
  assert.equal(activeCues(cues, 3.5)[0].text, 'Second');
  assert.equal(activeCues(cues, 5).length, 0);
});

test('chapters: invalid entries are dropped, the current chapter is found by time', () => {
  const ch = normalizeChapters([{ start: 90, title: 'B' }, { start: 0, title: 'A' }, { start: -1, title: 'x' }, { start: 5, title: ' ' }]);
  assert.deepEqual(ch, [{ start: 0, title: 'A' }, { start: 90, title: 'B' }]);
  assert.equal(chapterIndexAt(ch, 10), 0);
  assert.equal(chapterIndexAt(ch, 90), 1);
  assert.equal(chapterIndexAt([], 10), -1);
});
