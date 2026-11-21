import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTripSummary, createTripSummaryRenderer } from '../web/liff-summary.js';

const trip = [
  'เชียงใหม่',
  'วันที่ 1 09:30 ประตูท่าแพ → ฝั่งตะวันออก → 11:45 ร้านอาหาร → ห้องแอร์',
  'วันที่ 2 08:00 <ชื่อสถานที่> → 17:15 สถานีรถไฟ',
].join('\n');

test('known Thai day and clock grammar preserves arrows within names', () => {
  assert.deepEqual(parseTripSummary(trip), {
    city: 'เชียงใหม่',
    days: [
      { number: 1, stops: [{ time: '09:30', name: 'ประตูท่าแพ → ฝั่งตะวันออก' }, { time: '11:45', name: 'ร้านอาหาร → ห้องแอร์' }] },
      { number: 2, stops: [{ time: '08:00', name: '<ชื่อสถานที่>' }, { time: '17:15', name: 'สถานีรถไฟ' }] },
    ],
  });
});

test('ambiguous, unknown and possibly clipped summaries remain raw text', () => {
  for (const raw of [
    'กรุงเทพฯ\nแผนยังไม่แน่นอน → ดูอีกที', 'วันแรก 09:00 รถไฟ', 'เมือง\nวันที่ 2 09:00 รถไฟ',
    'เมือง\nวันที่ 1 25:00 รถไฟ', 'เมือง\nวันที่ 1 09:00 รถไฟ → 18:',
    'เมือง\nวันที่ 1 09:00 ' + 'ก'.repeat(1981),
    'เมือง\nวันที่ 1 09:00 รถไฟ\nวันที่ 2 ',
  ]) assert.equal(parseTripSummary(raw), null, raw.slice(0, 100));
});

const element = (tag) => ({
  tag, children: [], dataset: {}, open: false, hidden: true,
  append(...nodes) { this.children.push(...nodes); },
  setAttribute(key, value) { this[key] = value; },
  replaceChildren(...nodes) { this.children = nodes; this.renders = (this.renders || 0) + 1; },
  querySelector(name) { return this.children.find(child => child.tag === name); },
  querySelectorAll() { return this.children.flatMap(node => node.children?.filter(child => child.tag === 'details') || []); },
  set innerHTML(value) { throw new Error('unsafe HTML: ' + value); },
});
const fixture = () => {
  const outer = element('details');
  const host = element('div');
  const doc = { createElement(tag) {
    const node = element(tag);
    node.focus = () => { doc.activeElement = node; };
    return node;
  } };
  return { outer, host, doc, render: createTripSummaryRenderer(outer, host, doc) };
};
test('default day and summary open, preserve user state and DOM across polling', () => {
  const { outer, host, render } = fixture();
  render(trip);
  assert.equal(outer.hidden, false);
  assert.equal(outer.open, true);
  const dayCards = host.children[1].children;
  assert.deepEqual(dayCards.map(day => day.open), [true, false]);
  assert.equal(dayCards[1].children[1].children[0].children[1].textContent, '<ชื่อสถานที่>');
  assert.equal(dayCards[1].children[1].children[0].children[0].dateTime, '08:00');
  outer.open = false;
  dayCards[0].open = false;
  dayCards[1].open = true;
  render(trip);
  assert.equal(host.renders, 1);
  render(trip.replace('สถานีรถไฟ', 'สถานีรถไฟใหม่'));
  assert.equal(outer.open, false);
  assert.deepEqual(host.children[1].children.map(day => day.open), [false, true]);
});

test('active vote starts summary collapsed and raw fallback is exact text', () => {
  const { outer, host, render } = fixture();
  const raw = 'ข้อมูลไม่ครบ\n  <b>รายละเอียด</b>  \n';
  render(raw, { activeVote: true });
  assert.equal(outer.open, false);
  assert.equal(host.children[0].textContent, raw);
  outer.open = true;
  render(raw, { activeVote: false });
  assert.equal(outer.open, true);
  render('');
  assert.equal(outer.hidden, true);
  assert.equal(host.children.length, 0);
});

test('six-day clipped summaries retain complete day cards and show the exact uncertain tail', () => {
  const days = Array.from({ length: 6 }, (_, i) =>
    'วันที่ ' + (i + 1) + ' 09:00 ' + 'สถานที่'.repeat(48) + ' → 11:00 ชื่อสถานที่',
  );
  const raw = ['เชียงใหม่', ...days].join('\n').slice(0, 2000);
  assert.equal(raw.length, 2000);
  const lastLine = raw.split('\n').at(-1);
  assert.match(lastLine, /^วันที่ 6 /);
  const parsed = parseTripSummary(raw);
  assert.deepEqual(parsed.days.map(day => day.number), [1, 2, 3, 4, 5]);
  assert.equal(parsed.remainder, lastLine);
  const { outer, host, render } = fixture();
  render(raw);
  assert.equal(outer.open, true);
  assert.equal(host.children[1].children.length, 5);
  assert.equal(host.children[2].textContent, 'สรุปอาจไม่ครบ');
  assert.equal(host.children[3].textContent, lastLine);
});

test('changed summary restores focus to the same day without reopening other days', () => {
  const { host, doc, render } = fixture();
  render(trip);
  const heading = host.children[1].children[1].children[0];
  heading.focus();
  render(trip.replace('สถานีรถไฟ', 'สถานีรถไฟใหม่'));
  const updatedDay = host.children[1].children[1];
  assert.notEqual(doc.activeElement, heading);
  assert.equal(doc.activeElement, updatedDay.children[0]);
  assert.equal(updatedDay.open, false);
});
