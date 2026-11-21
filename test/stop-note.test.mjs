import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitStopNote } from '../web/stop-note.js';

test('itinerary citations retain the clickable source separately from the Thai advice', () => {
  const url = 'https://www.wellingtonhotelwaterloo.co.uk/food?utm_source=openai';
  assert.deepEqual(splitStopNote('แนะนำจองโต๊ะ ([wellingtonhotelwaterloo.co.uk](' + url + '))'), {
    text: 'แนะนำจองโต๊ะ', sources: [url],
  });
  assert.deepEqual(splitStopNote('เช็ก [เมนูวันนี้](' + url + ') ' + url), {
    text: 'เช็ก เมนูวันนี้', sources: [url],
  });
  const wiki = 'https://example.org/Waterloo_(London)';
  assert.deepEqual(splitStopNote('จุดนัดพบ (' + wiki + ')'), { text: 'จุดนัดพบ', sources: [wiki] });
});

test('unsafe sources cannot become links in a saved itinerary', () => {
  assert.deepEqual(splitStopNote('[เมนู](javascript:alert(1))'), { text: 'เมนู', sources: [] });
  assert.equal(splitStopNote('https://user:pass@example.org/path').sources.length, 0);
  assert.deepEqual(splitStopNote('เผื่อเวลา (15 นาที)'), { text: 'เผื่อเวลา (15 นาที)', sources: [] });
});
