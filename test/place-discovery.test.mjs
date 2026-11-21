import assert from 'node:assert/strict';
import test from 'node:test';
import { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { httpsUrl } from '../server/place-text.mjs';
import { pagePhoto, previewFromHead, publicPage } from '../server/photos.mjs';

process.env.BOP_PROVIDER = 'openai';
process.env.BOP_CACHE_DIR = await mkdtemp(join(tmpdir(), 'bop-discovery-'));
after(() => rm(process.env.BOP_CACHE_DIR, { recursive: true, force: true }));
process.env.OPENAI_API_KEY = 'research-test-key';
delete process.env.BOP_FAKE_LLM;
const { normalizeInfo, placeInfo } = await import('../server/research.mjs');
const { normalizeQuestions, resolvePicks, matchesPick, candidates } = await import(
  '../server/candidates.mjs'
);
const { normalize } = await import('../server/domain.mjs');
const signal = () => new AbortController().signal;
const context = () => ({ usage: {}, signal: signal(), step: () => {} });
function reply(value, tools = []) {
  const response = {
    status: 'completed',
    output: [...tools, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  };
  return new Response(
    'event: response.completed\ndata: ' + JSON.stringify({ type: 'response.completed', response }) + '\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}
test('canonicalizes Markdown and rejects unsafe page inputs and previews', async (t) => {
  assert.equal(httpsUrl('![place](https://cdn.example/wat.jpg)'), 'https://cdn.example/wat.jpg');
  assert.equal(httpsUrl('<https://cdn.example/wat.jpg>'), 'https://cdn.example/wat.jpg');
  assert.equal(httpsUrl('https://a:b@cdn.example/wat.jpg'), '');
  for (const url of [
    'https://example.local/a',
    'https://127.0.0.1',
    'https://[::1]',
    'https://user@news.example/p',
    'http://news.example',
    'https://news.example:444',
  ])
    assert.equal(publicPage(url), '');
  const page = 'https://news.example/photos',
    stop = { n: 'Wat Umong' };
  const tag = (property, content) => '<meta content="' + content + '" property="' + property + '">';
  const make = (image = 'https://cdn.example/photo.jpg', title = 'Wat Umong', width = 400) =>
    tag('og:image', image) + tag('og:title', title) + tag('og:image:width', width);
  assert.equal(previewFromHead(make(), page, stop).match, 'likely');
  assert.equal(previewFromHead(make('https://cdn.example/logo.svg'), page, stop), null);
  assert.equal(previewFromHead(make(undefined, 'Wat Uma'), page, stop), null);
  assert.equal(previewFromHead(make(undefined, undefined, 120), page, stop), null);
  const og = make(undefined, 'Indian restaurant in Covent Garden | Dishoom');
  assert.ok(previewFromHead(og, 'https://www.dishoom.com/covent-garden/', { n: 'Dishoom Covent Garden' }));
  assert.equal(previewFromHead(og, 'https://www.dishoom.com/shoreditch/', { n: 'Dishoom Kensington' }), null);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(null, { status: 301, headers: { Location: 'https://127.0.0.1/private' } });
  });
  assert.equal(await pagePhoto(page, stop, signal()), null);
  assert.equal(calls, 1);
});
test('removes source parentheticals before bounding facts while keeping distinct cited pages', () => {
  const base = 'https://venue.example/menu';
  const cited = [base + '?utm_source=openai', base];
  const note = 'เมนูวันอาทิตย์ (ตัวอย่าง) (venue.example)';
  const info = normalizeInfo({
    cited, verified: cited, value: {
      details: { what: note, highlights: [note], hours: 'เปิด (อา.) ([ร้าน](https://venue.example/hours))' },
      summary: note, tips: [note], dishes: [{ name: 'ต้มยำ (venue.example)', why: note, veg: true }],
    },
  }, { k: 'food' });
  assert.equal(info.details.what, 'เมนูวันอาทิตย์ (ตัวอย่าง)');
  assert.deepEqual(info.details.highlights, [info.details.what]);
  assert.equal(info.summary, info.tips[0]);
  assert.equal(info.details.hours, 'เปิด (อา.)');
  assert.deepEqual(info.dishes[0], { name: 'ต้มยำ', price: null, why: info.summary, veg: true });
  assert.deepEqual(info.sources.map(s => s.url), [base]);
});
test('reads Sunday dishes with listed prices from a branch’s public embedded menu', async (t) => {
  const { publishedMenu } = await import('../server/menu-source.mjs');
  const base = 'https://venue.example', page = base + '/food/menu';
  const items = (name) => [{ '@type': 'MenuItem', name, offers: { price: '22.95', priceCurrency: 'GBP' }, suitableForDiet: 'https://schema.org/VegetarianDiet' }];
  const json = { '@type':'Menu', hasMenuSection: [
    { '@type':'MenuSection', name:'Mains', hasMenuItem: items('Pasta') },
    { '@type':'MenuSection', name:'Sunday Roasts', hasMenuItem: items('Nut roast') },
  ] };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(String(url));
    if (String(url) === page)
      return new Response('<head><title>The Wellington | Menus</title></head><script src="https://menus.tenkites.com/Scripts/embed.js"></script><script>var options={url:"/api/tenkites?menuId=branch"}</script>', { headers:{ 'content-type':'text/html' } });
    return Response.json('<script type="application/ld+json">' + JSON.stringify(json) + '</script>');
  });
  const stop = { n: 'The Wellington', src: { url: page }, date:'2026-11-22' };
  const result = await publishedMenu(stop, [], signal());
  assert.equal(result.page, page);
  assert.deepEqual(result.dishes.map(d => d.name), ['Nut roast','Pasta']);
  assert.deepEqual(result.dishes[0].priceLocal, { amount: 22.95, currency: 'GBP' });
  assert.equal(result.dishes[0].veg, true);
  assert.equal((await publishedMenu({ ...stop, date: '2026-11-23' }, [], signal())).dishes.length, 1);
  assert.equal(await publishedMenu({ ...stop, n: 'Other venue' }, [], signal()), null);
  assert.ok(requests.every(url => url.startsWith(base + '/')));
});
test('places confirmed citations first, converts local prices, bounds text and hides photo hints', () => {
  const verified = new Set(['https://one.example/', 'https://two.example/']);
  const value = {
    summary: 'x'.repeat(400),
    details: { highlights: Array(9).fill('x'), what: 'z'.repeat(500) },
    confidence: 'web',
    hours: 'h'.repeat(90),
    tips: Array(8).fill('x'),
    rate: 0.0014,
    photoPage: 'https://photo.example/',
    dishes: [
      { name: 'Phở', price: 80000, priceLocal: { amount: 80000, currency: 'VND' } },
      { name: 'Tea', price: 'varies' },
    ],
    sources: [
      { url: '[1](https://one.example/)' },
      { url: 'https://invented.example/' },
      { url: 'https://two.example/' },
    ],
  };
  const result = normalizeInfo({ verified, cited: new Set(['https://two.example/']), value }, { k: 'food' });
  assert.deepEqual(
    result.sources.map((s) => s.url),
    ['https://two.example/', 'https://one.example/'],
  );
  assert.equal(result.confidence, 'web');
  assert.equal(result.dishes[0].price, 112);
  assert.equal(result.dishes[1].price, null);
  assert.equal(result.dishes[0].priceLocal.amount, 80000);
  assert.equal(result.summary.length, 300);
  assert.equal(result.details.what.length, 400);
  assert.equal(result.hours.length, 80);
  assert.equal(result.details.highlights.length, 5);
  assert.equal(result.tips.length, 5);
  assert.equal(Object.hasOwn(result, 'photoPage'), false);
  assert.equal(Object.hasOwn(result, 'phone'), false);
  assert.equal(
    normalizeInfo({ verified, value: { ...value, confidence: 'estimate' } }, { k: 'sight' }).confidence,
    'estimate',
  );
  assert.equal(normalizeInfo({ verified, value }, { k: 'sight' }).dishes.length, 0);
});
test('concurrent place lookups share the first request, distinguish renamed stops, and evict failures', async (t) => {
  const calls = [];
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  t.mock.method(globalThis, 'fetch', async (_, init) => {
    const body = JSON.parse(init.body);
    calls.push(JSON.parse(body.input[0].content.split('ข้อมูล JSON:\n')[1]));
    if (calls.length === 1) await hold;
    if (calls.length === 3) return Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 });
    return reply({});
  });
  const stop = {
    id: 'cafe',
    n: 'Cafe #17',
    k: 'food',
    query: 'A',
    aliases: ['X'],
    place: { query: 'B', aliases: ['Y'] },
  };
  const a = placeInfo({ stop }, context()),
    b = placeInfo({ stop, city: 'Hanoi' }, context());
  release();
  const [first, second] = await Promise.all([a, b]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].city, 'เชียงใหม่');
  assert.deepEqual(calls[0].stop.aliases, ['X', 'Y']);
  assert.equal(calls[0].stop.query, 'A');
  assert.equal(first.info.summary, 'ยังไม่มีข้อมูล');
  assert.equal(second.cached, true);
  assert.equal(first.usage.provider, 'openai');
  const named = { stop: { ...stop, n: 'renamed' } };
  await placeInfo(named, context());
  const fail = { stop: { ...stop, id: 'retry1' } };
  await assert.rejects(placeInfo(fail, context()), { code: 'auth' });
  assert.equal((await placeInfo(fail, context())).cached, undefined);
  assert.equal(calls.length, 4);
  await assert.rejects(placeInfo({ stop: { n: 'no id' } }, context()), { code: 'bad_request' });
});
test('limits candidate output and keeps research-only inputs internal; must picks survive restart', () => {
  const duplicate = {
    id: 'wat_umong',
    name: 'Wat Umong',
    price: 'range'.repeat(24),
    why: 'x'.repeat(220),
    tags: Array(6).fill('a'.repeat(30)),
    query: 'วัดอุโมงค์',
    aliases: ['Temple'],
    photoPage: 'https://restaurant.example/',
    src: { checked: 'web', url: 'https://invalid.example/' },
  };
  const raw = [
    {
      kind: 'bad',
      options: [
        { name: ' ' },
        duplicate,
        { ...duplicate, src: { checked: 'web', url: 'https://ok.example/' } },
      ],
    },
    { kind: 'food', options: [] },
  ];
  const [q] = normalizeQuestions(
    { verified: new Set(['https://ok.example/']), value: { questions: raw } },
    3,
  );
  assert.equal(q.kind, 'sight');
  assert.ok(q.title);
  assert.equal(q.options.length, 2);
  const [a, b] = q.options;
  assert.equal(a.option.id, 'c3_wat_umong');
  assert.equal(b.option.id, 'c3_wat_umong_');
  assert.equal(a.option.src, undefined);
  assert.equal(b.option.src.checked, 'web');
  assert.equal(a.option.tags.length, 4);
  assert.equal(a.option.tags[0].length, 24);
  assert.equal(a.option.price, duplicate.price);
  assert.equal(a.option.why.length, 200);
  const picks = resolvePicks({ must: [{ id: 'gone', name: 'Wat Umong', ll: [18, 99] }], avoid: ['gone'] });
  assert.ok(matchesPick({ ll: [18.0001, 99] }, picks.must[0]));
  assert.equal(matchesPick({ ll: [18.0001, 99] }, picks.must[0], false), false);
  assert.equal(picks.avoid[0].name, 'gone');
});
test('candidate discovery uses verified search URLs, a matched preview and remembered geo coordinates', async (t) => {
  const city = 'ดานัง';
  const setup = normalize({
    city,
    startDate: '2026-11-23',
    days: 1,
    members: [{ name: 'A', avoid: 'กุ้ง' }],
    picks: { must: [{ name: 'do-not-send' }] },
  });
  const source = 'https://river.example/pho';
  const place = 'River Noodles';
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    if (url.hostname === 'api.openai.com') {
      const body = JSON.parse(init.body);
      requests.push(body);
      return reply(
        {
          questions: [
            {
              kind: 'food',
              options: [
                {
                  id: 'pho',
                  name: place,
                  query: place,
                  aliases: ['River restaurant'],
                  src: { checked: 'web', url: source },
                  photoPage: source,
                },
              ],
            },
          ],
        },
        [{ type: 'web_search_call', id: 's', action: { sources: [{ url: source }] } }],
      );
    }
    if (url.hostname.includes('photon'))
      return Response.json({
        features: [
          { properties: { name: place, osm_key: 'amenity' }, geometry: { coordinates: [108.219, 16.06] } },
        ],
      });
    if (url.hostname === 'river.example')
      return new Response(
        '<head><title>River Noodles Menu</title><meta property="og:image" content="https://cdn.example/pho.jpg"></head>',
        { headers: { 'content-type': 'text/html' } },
      );
    throw new Error('Unexpected URL ' + url.href);
  });
  let summary;
  const result = await candidates(setup, { ...context(), step: (s) => (summary = s) });
  const option = result.questions[0].options[0];
  assert.equal(requests.length, 1);
  assert.equal(requests[0].max_tool_calls, 5);
  assert.ok(!requests[0].input[0].content.includes('do-not-send'));
  assert.ok(requests[0].input[0].content.includes('กุ้ง'));
  assert.equal(option.photo.match, 'likely');
  assert.equal(option.src.url, source);
  assert.equal(option.query, undefined);
  assert.equal(option.photoPage, undefined);
  assert.equal(option.aliases, undefined);
  assert.match(summary, /ได้ 1 คำถาม · 1 ตัวเลือก · มีรูป 1/);
  assert.deepEqual(option.ll, [16.06, 108.219]);
  const picks = resolvePicks({ must: [{ ...option, ll: [16.07, 108.22] }], avoid: [option.id] });
  assert.deepEqual(picks.must[0].ll, [16.07, 108.22]);
  assert.deepEqual(picks.avoid[0].ll, option.ll);
  assert.equal(picks.avoid[0].query, place);
});
test('Commons exact match requires name and distance, uses P18 and credited file metadata', async (t) => {
  const { exactPhoto } = await import('../server/photos.mjs?case=wikidata');
  const hit = {
    title: 'Broader article',
    pageprops: { wikibase_item: 'Q100' },
    coordinates: [{ lat: 18.8, lon: 99 }],
  };
  const file = {
    title: 'File:Wat Actual.jpg',
    imageinfo: [
      {
        url: 'https://upload.wikimedia.org/temple.jpg',
        thumburl: 'https://upload.wikimedia.org/thumb.jpg',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Wat_Actual.jpg',
        extmetadata: { Artist: { value: '<b>Artist</b>' }, LicenseShortName: { value: 'CC BY 4.0' } },
      },
    ],
  };
  let fileCalls = 0;
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input);
    if (url.hostname.includes('wikipedia.org')) return Response.json({ query: { pages: [hit] } });
    if (url.hostname.includes('wikidata.org'))
      return Response.json({
        entities: {
          Q100: {
            aliases: { th: [{ value: 'วัดตัวอย่าง' }] },
            claims: { P18: [{ mainsnak: { datavalue: { value: 'Wat Actual.jpg' } } }] },
          },
        },
      });
    fileCalls++;
    return Response.json({ query: { pages: [file] } });
  });
  assert.equal(await exactPhoto({ n: 'Only related', ll: [18.8, 99] }, signal()), null);
  assert.equal(fileCalls, 0);
  assert.equal(await exactPhoto({ n: 'วัดตัวอย่าง', ll: [17, 99] }, signal()), null);
  assert.equal(fileCalls, 0);
  const image = await exactPhoto({ n: 'วัดตัวอย่าง', ll: [18.8, 99] }, signal());
  assert.equal(image.match, 'exact');
  assert.equal(image.credit, 'Artist · CC BY 4.0 · Wikimedia Commons');
  assert.equal(image.thumb, 'https://upload.wikimedia.org/thumb.jpg');
  assert.equal(image.url, 'https://upload.wikimedia.org/temple.jpg');
  assert.equal(fileCalls, 1);
});
test('persistent Wikimedia 429 retries once then holds further file lookups', async (t) => {
  const { exactPhoto, nearbyPhoto } = await import('../server/photos.mjs?case=wikimedia429');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(null, { status: 429 });
  });
  const stop = { n: 'Research Place', ll: [18.8, 99] };
  assert.equal(await exactPhoto(stop, signal()), null);
  assert.equal(calls, 2);
  assert.equal(await nearbyPhoto(stop, signal()), null);
  assert.equal(calls, 2);
  assert.equal(await exactPhoto({ n: 'Other Place', ll: null }, signal()), null);
  assert.equal(calls, 2);
});
