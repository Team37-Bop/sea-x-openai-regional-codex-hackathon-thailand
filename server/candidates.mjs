export { matchesPick } from './pick-match.mjs';
import { coordinates } from './domain.mjs';
import { findCity, findPlace } from './geo.mjs';
import { model, provider } from './model.mjs';
import { catalogPlace } from './sample.mjs';
import { exactPhoto, nearbyPhoto, pagePhoto, publicPage } from './photos.mjs';
import { boundedStrings, httpsUrl, list, placeText } from './place-text.mjs';

const memory = new Map();
let run = 0;

const prompt =
  'ช่วยกลุ่มเปรียบเทียบสถานที่จริงในเมืองนี้ ถามเป็นภาษาไทยหนึ่งคำถามต่อหมวดที่ระบุใน categories เป้าหมาย 4 ตัวเลือกที่แตกต่างกันต่อคำถาม ให้ได้ถึง 6 ถ้ามีที่เหมาะจริง ' +
  'จำนวนนี้เป็นทางเลือกให้พิจารณา แม้ทริปวันเดียวก็เสนอหลายร้านและหลายที่เที่ยวได้ เลือกให้ต่างกันทั้งประสบการณ์ ย่าน หรือราคา และให้เข้ากับเวลา งบ การเดินและสิ่งที่สมาชิกสนใจ หลีกเลี่ยงการเสนอจุดเดิมซ้ำต่างชื่อ ' +
  'ใช้ผลค้นที่ระบุสถานที่จริง เช่น บทความที่รวบรวมหลายสถานที่หรือหน้าเว็บไซต์ของแต่ละแห่ง หากยืนยันไม่ได้หรือหมวดนั้นขัดกับคำขอให้ส่งเท่าที่เหมาะ ห้ามสร้างชื่อ ราคา หรือลิงก์เพื่อให้ครบจำนวน ' +
  'บอกข้อดี tags ราคาต่อคนแบบสั้น เช่น £20–30 ต่อคน พิกัด query และ aliases สำหรับหา POI, photoPage หน้าเว็บที่มีรูปของสถานที่หรือย่านนี้ ' +
  'ร้านอาหารระบุเมนูที่เหมาะกับข้อจำกัดอาหารของสมาชิกแต่ละคนตามหลักฐาน ถ้ายืนยันไม่ได้ให้บอกตรง ๆ ไม่รับรองความปลอดภัยของอาหาร ใส่ src.checked=web กับ URL ผลค้นที่อ้างได้';

export function resolvePicks(input = {}) {
  const must = list(input?.must)
    .filter((pick) => pick && typeof pick === 'object' && placeText(pick.name))
    .slice(0, 15)
    .map((pick) => {
      const saved = memory.get(pick.id);
      return {
        id: placeText(pick.id, 200),
        name: placeText(pick.name),
        query: placeText(pick.query) || saved?.query || placeText(pick.name),
        kind: placeText(pick.kind, 20) || saved?.kind,
        ll: coordinates(pick.ll) ? pick.ll : saved?.ll,
      };
    });
  const avoid = list(input?.avoid)
    .slice(0, 30)
    .map((pick) => {
      const id = placeText(typeof pick === 'string' ? pick : pick?.id, 200);
      return memory.get(id) || { id, name: placeText(pick?.name || id), query: placeText(pick?.query) };
    })
    .filter((p) => p.name);
  return { must, avoid };
}
const titles = { sight: 'อยากไปเที่ยวที่ไหนบ้าง', food: 'สนใจร้านอาหารไหนบ้าง', stay: 'อยากพักย่านไหน' };
const priceWords = new Intl.Segmenter('th', { granularity: 'word' });
function priceHint(value) {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : placeText(value, 1600);
  if (text.length <= 240) return text;
  let end = 0;
  for (const { segment, index } of priceWords.segment(text)) {
    if (index + segment.length > 239) break;
    end = index + segment.length;
  }
  return text.slice(0, end || 239).trimEnd() + '…';
}
const comparable = value => placeText(value).normalize('NFKC').toLowerCase()
  .replace(/^the\s+/i, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
function sameVenue(a, b) {
  const names = [comparable(a.option.name), comparable(a.stop.query)];
  return [comparable(b.option.name), comparable(b.stop.query)].some(name => name && names.includes(name));
}
function addDistinct(options, entry) {
  const previous = options.find(item => sameVenue(item, entry));
  if (previous) {
    if (!previous.option.src && entry.option.src) {
      previous.option.src = entry.option.src;
      previous.photoPage ||= entry.photoPage;
    }
  } else if (options.length < 6) options.push(entry);
}
export function normalizeQuestions(result, runId, ids = new Set()) {
  const verified = new Set([...(result.verified || []), ...(result.cited || [])].map(httpsUrl).filter(Boolean));
  return list(result.value.questions)
    .slice(0, 3)
    .flatMap((q, i) => {
      const kind = ['food', 'sight', 'stay'].includes(q?.kind) ? q.kind : 'sight';
      const entries = list(q?.options)
        .filter((item) => placeText(item?.name))
        .slice(0, 24)
        .map((item) => {
          const name = placeText(item.name);
          const slug =
            (placeText(item.id) || name)
              .normalize('NFKC')
              .toLowerCase()
              .replace(/[^\p{L}\p{M}\p{N}]+/gu, '_')
              .replace(/^_+|_+$/g, '')
              .slice(0, 80) || 'place';
          let id = 'c' + runId + '_' + slug;
          while (ids.has(id)) id += '_';
          ids.add(id);
          const raw = item.src;
          const url = httpsUrl(raw?.url || (typeof raw === 'string' ? raw : ''));
          const src =
            (raw?.checked ?? item.checked) === 'web' && verified.has(url)
              ? { url, title: placeText(raw?.title) || new URL(url).hostname, checked: 'web' }
              : undefined;
          const price = priceHint(item.price);
          const option = {
            id,
            name,
            why: placeText(item.why, 200),
            tags: boundedStrings(item.tags, 4, 24),
            ...(price ? { price } : {}),
            ...(src ? { src } : {}),
          };
          const stop = {
            n: name,
            k: kind === 'stay' ? 'area' : kind,
            query: placeText(item.query) || name,
            aliases: boundedStrings(item.aliases, 8, 80),
            ll: coordinates(item.ll) ? item.ll : undefined,
          };
          return { option, stop, catalogId: item.catalogId, photoPage: publicPage(item.photoPage) };
        });
      const options = [];
      for (const entry of entries) addDistinct(options, entry);
      return options.length
        ? [{ id: 'q' + (i + 1), kind, title: placeText(q.title) || titles[kind], multi: true, options }]
        : [];
    });
}
function combineQuestions(questions, incoming, allowed, requireSource = false) {
  for (const question of incoming) {
    if (!allowed.includes(question.kind)) continue;
    let target = questions.find(item => item.kind === question.kind);
    if (!target) {
      target = { ...question, id: 'q' + (questions.length + 1), options: [] };
      questions.push(target);
    }
    for (const entry of question.options) {
      if (requireSource && !entry.option.src) continue;
      const elsewhere = questions.some(other => other !== target && other.options.some(item => sameVenue(item, entry)));
      if (!elsewhere) addDistinct(target.options, entry);
    }
  }
}
async function discoverQuestions(discovery, restrictions, ctx) {
  const categories = ['food', 'sight'];
  if (discovery.days > 1 && discovery.stay?.mode !== 'booked') categories.push('stay');
  const input = { setup: discovery, restrictions, categories };
  const result = await model(prompt, input, { ...ctx, operation: 'candidates', searches: 3 });
  const runId = ++run;
  const ids = new Set();
  const questions = [];
  combineQuestions(questions, normalizeQuestions(result, runId, ids), categories);
  const target = 4;
  const gaps = categories.map(kind => {
    const found = questions.find(q => q.kind === kind)?.options.length || 0;
    return { kind, needed: target - found };
  }).filter(gap => gap.needed > 0);
  if (provider !== 'fake' && gaps.length) {
    ctx.step('กำลังค้นตัวเลือกเพิ่มเติมให้กลุ่มเปรียบเทียบ');
    const existing = questions.flatMap(q => q.options.map(entry => entry.option.name));
    const missing = gaps.map(gap => gap.kind);
    try {
      const more = await model(prompt + ' รอบนี้เติมเฉพาะหมวดและจำนวนใน gaps ไม่ต้องส่งสถานที่ใน existing ซ้ำ ทุกสถานที่ที่เพิ่มต้องมีหน้าผลค้นสนับสนุน ถ้าไม่มีให้เว้น', {
        ...input, categories: missing, gaps, existing,
      }, { ...ctx, signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(50_000)]), operation: 'candidates', searches: 2 });
      combineQuestions(questions, normalizeQuestions(more, runId, ids), missing, true);
    } catch {
      ctx.signal.throwIfAborted();
      ctx.step('ใช้ตัวเลือกที่ค้นได้ในรอบแรก');
    }
  }
  return questions.filter(q => q.options.length);
}
async function group(items, width, work) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(items.length, width) }, async () => {
      while (cursor < items.length) await work(items[cursor++]);
    }),
  );
}
async function photoStage(items, width, timeout, ctx, work) {
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(timeout)]);
  await group(items, width, async (entry) => {
    if (signal.aborted || entry.option.photo) return;
    try {
      const photo = await work(entry, signal);
      if (!signal.aborted && photo) {
        const { url, thumb, credit, page, match } = photo;
        entry.option.photo = { url, ...(thumb ? { thumb } : {}), credit, page, match };
      }
    } catch {
      ctx.signal.throwIfAborted();
    }
  });
  ctx.signal.throwIfAborted();
}
async function firstPass(entry, signal) {
  const urls = [...new Set([entry.photoPage, entry.option.src?.url].filter(Boolean))];
  // Reserve time for a confirmed source even when Wikimedia is queued or unavailable.
  const wikiSignal = AbortSignal.any([signal, AbortSignal.timeout(6500)]);
  const [exact, ...previews] = await Promise.all([
    exactPhoto(entry.stop, wikiSignal).catch(() => null),
    ...urls.map((url) => pagePhoto(url, entry.stop, signal)),
  ]);
  signal.throwIfAborted();
  return exact || previews.find(Boolean) || null;
}
export async function candidates(setup, ctx) {
  const started = performance.now();
  const { picks: _picks, ...discovery } = setup;
  if (!setup.cityLL || !setup.country) {
    const city = await findCity(setup.city, ctx.signal);
    discovery.cityLL ??= city?.ll;
    discovery.country ||= city?.cc;
  }
  const restrictions = setup.members.filter((m) => m.avoid).map((m) => ({ name: m.name, avoid: m.avoid }));
  ctx.step('กำลังค้นหาสถานที่ให้สมาชิกเลือก');
  const questions = await discoverQuestions(discovery, restrictions, ctx);
  const items = questions.flatMap((q) => q.options);
  const offline = provider === 'fake';
  const batch = { remaining: 8 };
  await Promise.all([
    group(items, 4, async (entry) => {
      const hint = entry.stop.ll;
      const catalog = catalogPlace(setup.city, entry);
      const point =
        catalog?.ll ??
        (offline
          ? null
          : await findPlace(
              entry.stop.query + ' ' + setup.city,
              hint || discovery.cityLL,
              hint ? 3 : 40,
              ctx.signal,
              batch,
            ));
      if (coordinates(point ?? hint)) entry.option.ll = point ?? hint;
    }),
    offline ? undefined : photoStage(items, items.length, 15_000, ctx, firstPass),
  ]);
  for (const entry of items) entry.stop.ll = entry.option.ll;
  if (!offline) {
    await photoStage(items, items.length, 10_000, ctx, (entry, signal) => nearbyPhoto(entry.stop, signal));
    await photoStage(items, 6, 60_000, ctx, async (entry, signal) => {
      const result = await model(
        'ค้นเพียงหนึ่งครั้ง หา URL หน้าเว็บที่มีรูปของสถานที่ตรงชื่อและสาขา สำหรับที่พักให้หาย่านนั้นโดยตรง คืน pages เป็น URL ของหน้าที่ค้นเจอ',
        { city: discovery.city, country: discovery.country, stop: entry.stop },
        { ...ctx, signal, operation: 'pages', searches: 1 },
      );
      const urls = [
        ...new Set([
          ...list(result.value.pages)
            .map(httpsUrl)
            .filter((url) => result.verified.has(url)),
          ...result.cited,
          ...result.verified,
        ]),
      ];
      for (const url of urls.slice(0, 4)) {
        const preview = await pagePhoto(url, entry.stop, signal);
        if (preview) return preview;
      }
      return null;
    });
  }
  for (const q of questions) {
    q.options = q.options.map(({ option, stop }) => {
      memory.set(option.id, {
        id: option.id,
        name: option.name,
        query: stop.query,
        kind: q.kind,
        ll: option.ll,
      });
      return option;
    });
  }
  ctx.step(
    'ได้ ' +
      questions.length +
      ' คำถาม · ' +
      items.length +
      ' ตัวเลือก · มีรูป ' +
      items.filter((e) => e.option.photo).length,
  );
  return { questions, ms: Math.round(performance.now() - started), usage: ctx.usage };
}
