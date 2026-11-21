import assert from 'node:assert/strict';
import { normalizeHttpsUrl, photosFor } from '../server/photos.mjs';
import { stopFromSpec } from '../src/plan.js';
import { candCard, photoStrip, safeUrl } from '../src/ui/place.js';

const markdown = '![วิว](https://images.example.com/place.jpg)';
assert.equal(normalizeHttpsUrl(markdown), 'https://images.example.com/place.jpg');
assert.equal(safeUrl(markdown), 'https://images.example.com/place.jpg');
assert.equal(normalizeHttpsUrl('[แหล่งข้อมูล](https://example.com/page)'), 'https://example.com/page');
console.log('ok   Markdown image and link wrappers normalize to safe URLs');

const photos = await photosFor({
  name: 'Place', ll: [13.7, 100.5], pages: [], wiki: [{ url: markdown, page: '[source](https://example.com/page)', match: 'exact' }],
});
assert.equal(photos[0].url, 'https://images.example.com/place.jpg');
assert.equal(photos[0].page, 'https://example.com/page');
console.log('ok   server photo pipeline stores canonical URLs');

const stop = stopFromSpec({
  n: '![รูปวัด](https://images.example.com/temple.jpg) วัดตัวอย่าง',
  note: 'ดู [รายละเอียด](https://example.com/temple)',
  checked: 'web',
  srcUrl: '[หน้าเว็บ](https://example.com/temple)',
  srcTitle: '[ข้อมูลวัด](https://example.com/temple)',
});
assert.equal(stop.n, 'รูปวัด วัดตัวอย่าง');
assert.equal(stop.note, 'ดู รายละเอียด');
assert.equal(stop.src.url, 'https://example.com/temple');
assert.equal(stop.src.title, 'ข้อมูลวัด');
console.log('ok   model Markdown is removed from user-facing place fields');

const strip = photoStrip([markdown], 'Place');
const card = candCard({ name: 'Place', photo: markdown }, null, null);
assert.match(strip, /src="https:\/\/images\.example\.com\/place\.jpg"/);
assert.match(card, /src="https:\/\/images\.example\.com\/place\.jpg"/);
assert.doesNotMatch(strip + card, /!\[/);
console.log('ok   image components render normalized URLs instead of Markdown');

console.log('all passed');
