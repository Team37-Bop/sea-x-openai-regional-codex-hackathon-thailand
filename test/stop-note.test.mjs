import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderStopNote, splitStopNote } from '../web/stop-note.js';

test('itinerary notes separate source URLs from the Thai advice', () => {
  const url = 'https://www.wellingtonhotelwaterloo.co.uk/food?utm_source=openai';
  assert.deepEqual(splitStopNote('แนะนำจองโต๊ะ ([wellingtonhotelwaterloo.co.uk](' + url + '))'), {
    text: 'แนะนำจองโต๊ะ', sources: [url],
  });
  assert.deepEqual(splitStopNote('เช็ก [เมนูวันนี้](' + url + ') ' + url), {
    text: 'เช็ก เมนูวันนี้', sources: [url],
  });
  const wiki = 'https://example.org/Waterloo_(London)';
  assert.deepEqual(splitStopNote('จุดนัดพบ (' + wiki + ')'), { text: 'จุดนัดพบ', sources: [wiki] });
  assert.deepEqual(splitStopNote('เปิดทุกวัน (example.org/menu) <https://example.org/hours>'), {
    text: 'เปิดทุกวัน', sources: ['https://example.org/menu', 'https://example.org/hours'],
  });
  assert.equal(splitStopNote('จองล่วงหน้า (example.org/menu).').text, 'จองล่วงหน้า.');
  assert.deepEqual(splitStopNote('จองล่วงหน้า ([ที่มา](<https://example.org/book?times[]=30> "Book"))'), {
    text: 'จองล่วงหน้า', sources: ['https://example.org/book?times[]=30'],
  });
});

test('saved replan summaries keep both lines and strip a source even when Markdown was escaped', () => {
  const url = 'https://careers.tate.org.uk/members/modules/jobV2/download.php?record=file.pdf&utm_source=openai';
  const intro = 'Bop: งบเพิ่ม 0 บาทต่อคน เดินไปชมคอลเลกชันถาวร';
  const owner = 'ผู้จัดทริป: ตรวจเวลาเดินกลับเมื่อทราบที่อยู่โรงแรม';
  const clean = intro + '\n' + owner;
  for (const raw of [
    intro + ' ([careers.tate.org.uk](' + url + '))\n' + owner,
    intro + ' ([careers.tate.org.uk]\\(' + url.replace('https:', 'https\\:') + '\\))\\\n' + owner,
  ]) assert.deepEqual(splitStopNote(raw), { text: clean, sources: [url] });
});

test('unsafe sources cannot become links in a saved itinerary', () => {
  assert.deepEqual(splitStopNote('[เมนู](javascript:alert(1))'), { text: 'เมนู', sources: [] });
  assert.equal(splitStopNote('https://user:pass@example.org/path').sources.length, 0);
  assert.deepEqual(splitStopNote('เผื่อเวลา (15 นาที)'), { text: 'เผื่อเวลา (15 นาที)', sources: [] });
});

test('the itinerary note renders advice without adding citation links', (t) => {
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'p');
      return {};
    },
  };
  t.after(() => { delete globalThis.document; });
  const venue = 'https://example.org/menu';
  assert.deepEqual(renderStopNote('ดูเมนูก่อนจอง (' + venue + ')', 'stop-note'), {
    className: 'stop-note', textContent: 'ดูเมนูก่อนจอง',
  });
  assert.equal(renderStopNote(venue, 'stop-note'), null);
});
