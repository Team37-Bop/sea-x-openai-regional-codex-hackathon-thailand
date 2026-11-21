import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderStopNote, splitStopNote } from '../web/stop-note.js';

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

test('both verified sources and ordinary note links remain clickable with distinct labels', (t) => {
  const anchors = [];
  globalThis.document = {
    createElement(tag) {
      if (tag === 'p') return { append() {} };
      const anchor = { setAttribute() {} };
      anchors.push(anchor);
      return anchor;
    },
  };
  t.after(() => { delete globalThis.document; });
  const venue = 'https://example.org/menu';
  const other = 'https://example.org/offers';
  renderStopNote(venue + '#dinner ' + other, 'stop-note', { checked: 'web', url: venue });
  renderStopNote(venue, 'pd-note', { checked: 'estimate', url: venue });
  renderStopNote(other, 'stop-note');
  assert.deepEqual(anchors.map(({ href, textContent }) => [href, textContent]), [
    [venue + '#dinner', 'แหล่งข้อมูล 1'],
    [other, 'ลิงก์ในหมายเหตุ 2'],
    [venue, 'ลิงก์ในหมายเหตุ'],
    [other, 'ลิงก์ในหมายเหตุ'],
  ]);
});
