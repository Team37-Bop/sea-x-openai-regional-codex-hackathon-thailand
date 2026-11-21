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
  'เสนอคำถามภาษาไทยตามความต้องการของกลุ่ม ไม่เกิน 3 คำถาม kind food/sight/stay คำถามละไม่เกิน 6 สถานที่จริง ' +
  'บอกข้อดี tags ราคาโดยประมาณต่อคนเป็นข้อความ พิกัด query และ aliases สำหรับหา POI, photoPage หน้าเว็บที่มีรูปของสถานที่หรือย่านนี้ ' +
  'ร้านอาหารทุกร้านต้องระบุให้สมาชิกแต่ละคนที่มี avoid ว่ามีเมนูใดกินได้ ตรวจด้วยแหล่งข้อมูลจริง ใส่ src.checked=web พร้อม URL เมื่อมีหลักฐานเท่านั้น';

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
export function normalizeQuestions(result, runId) {
  const ids = new Set();
  const verified = new Set([...result.verified].map(httpsUrl).filter(Boolean));
  return list(result.value.questions)
    .slice(0, 3)
    .flatMap((q, i) => {
      const kind = ['food', 'sight', 'stay'].includes(q?.kind) ? q.kind : 'sight';
      const options = list(q?.options)
        .filter((item) => placeText(item?.name))
        .slice(0, 6)
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
          const price = placeText(
            typeof item.price === 'number' && Number.isFinite(item.price) ? String(item.price) : item.price,
            60,
          );
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
      return options.length
        ? [{ id: 'q' + (i + 1), kind, title: placeText(q.title) || titles[kind], multi: true, options }]
        : [];
    });
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
        const { url, credit, page, match } = photo;
        entry.option.photo = { url, credit, page, match };
      }
    } catch {
      ctx.signal.throwIfAborted();
    }
  });
  ctx.signal.throwIfAborted();
}
async function firstPass(entry, signal) {
  const photo = await exactPhoto(entry.stop, signal);
  if (photo) return photo;
  for (const page of new Set([entry.photoPage, entry.option.src?.url].filter(Boolean))) {
    const preview = await pagePhoto(page, entry.stop, signal);
    if (preview) return preview;
  }
  return null;
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
  const result = await model(
    prompt,
    { setup: discovery, restrictions },
    { ...ctx, operation: 'candidates', searches: 5 },
  );
  const questions = normalizeQuestions(result, ++run);
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
