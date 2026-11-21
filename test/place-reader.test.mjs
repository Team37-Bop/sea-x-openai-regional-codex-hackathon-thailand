import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStopMenu, plannedVisit } from '../web/place-details.js';
import { samplePlaceInfo } from '../web/sample-place-details.js';

test('place reader keeps itinerary details available for a Thai-language, archived stop', () => {
  const stop = {
    id: 'meal',
    n: 'มื้อกลางวันที่ท่าเตียน',
    k: 'คาเฟ่และร้านอาหาร',
    t0: '11:25',
    t1: '12:45',
    cost: 250,
    days: { hours: { sun: '08:00–18:00' } },
    note: 'สั่งอาหารก่อนเดินต่อ ([source](https://example.org)) <https://example.org/menu> (example.org)',
    leg: { mode: 'walk', km: 0.6, min: 8 },
  };
  const day = {
    date: '2026-11-22',
    stops: [{ id: 'start', n: 'ท่าเตียน' }, stop],
  };
  const result = plannedVisit({
    stop,
    day,
    setup: { members: [{ name: 'ก้อง', wants: ['ท่าเตียน'] }] },
  });
  assert.equal(result.meal, true);
  assert.equal(result.duration, '80 นาที');
  assert.equal(result.cost, '฿250');
  assert.equal(result.wish, 'ก้อง');
  assert.equal(result.note, 'สั่งอาหารก่อนเดินต่อ');
  assert.match(result.hours, /อาทิตย์ 08:00–18:00/);
  assert.match(result.legText, /ท่าเตียน/);
});
test('the meal menu keeps note links in Sources and deduplicates the verified page', (t) => {
  globalThis.document = {
    createElement(tag) {
      return {
        tag,
        children: [],
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
        get childElementCount() { return this.children.length; },
        setAttribute() {},
        addEventListener(type, listener) { this[type] = listener; },
      };
    },
  };
  t.after(() => { delete globalThis.document; });
  const url = 'https://example.org/menu';
  const noteUrl = 'https://www.example.org/today';
  const menu = createStopMenu({
    city: 'เชียงใหม่',
    sample: true,
    stop: {
      id: 'meal', n: 'ตลาดวโรรส', k: 'food',
      src: { checked: 'web', title: 'เมนูร้าน', url },
      note: url + '?utm_source=search ' + noteUrl,
    },
  });
  const [toggle, body] = menu.children;
  toggle.click();
  const sources = body.children.find((section) => section.children[0]?.textContent === 'แหล่งข้อมูล');
  const links = sources.children[1].children;
  assert.deepEqual(links.map((link) => link.href), [url, noteUrl]);
  assert.equal(links[1].textContent, 'ลิงก์ในหมายเหตุ · www.example.org');
  const anchors = (element) => element.tag === 'a' ? [element] : element.children.flatMap(anchors);
  assert.deepEqual(anchors(body), links);
});
test('sample details use place-specific guidance and credited sources', () => {
  const gate = samplePlaceInfo('เชียงใหม่', 'ประตูท่าแพ');
  assert.ok(gate.highlights.length);
  assert.ok(gate.photos.every((photo) => photo.credit && photo.page.startsWith('https://')));
  assert.match(gate.sources[0].url, /tourismthailand.org/);
  const food = samplePlaceInfo('เชียงใหม่', 'ตลาดวโรรส');
  assert.ok(food.dishes.length);
  assert.deepEqual(samplePlaceInfo('กรุงเทพฯ', 'ประตูท่าแพ'), {});
});
