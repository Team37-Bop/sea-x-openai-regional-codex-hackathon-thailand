import { bad, cities, coordinates } from './domain.mjs';
import { model, provider, requireReady } from './model.mjs';
import { publishedMenu } from './menu-source.mjs';
import { startPlacePhotos } from './photos.mjs';
import { boundedStrings, httpsUrl, list, placeText, sourceIdentity } from './place-text.mjs';

const researchPrompt =
  'ค้นหาสถานที่จริงให้ตรงชื่อ สาขา เมืองและพิกัด จากเว็บอย่างมากสามครั้ง สรุปเป็นภาษาไทย what, highlights, ราคา เวลาเปิด เรตติ้ง การจอง ที่อยู่ โทรศัพท์และเคล็ดลับตามหลักฐาน ' +
  'ร้านอาหารให้ค้นเมนูของสาขานี้ โดยเริ่มจากเว็บร้านและเมนูที่ตรงกับมื้อในแผน แนะนำ 3–6 จานเมื่อมีหลักฐาน บอกชื่อจานและเหตุผลสั้น ๆ เป็นภาษาไทย เก็บชื่อบนเมนูไว้ด้วย ' +
  'ถ้าเป็นเมนูตัวอย่างให้ระบุ ใช้ veg=true เฉพาะจานที่หลักฐานระบุว่ามังสวิรัติ คืนราคาของจานเป็น THB, priceLocal {amount,currency} และ rate จำนวนบาทต่อหนึ่งหน่วยท้องถิ่น ถ้าไม่มีราคาให้เว้นราคาได้ ' +
  'ถ้ามี publishedMenu ให้ถือว่าเป็นรายการที่อ่านจากหน้าเมนูของสาขานี้ ใช้ชื่อตามเมนู อธิบายเมนูและราคาชัดเจน หากไม่มีรายการให้เว้น dishes ไม่ต้องเล่าเรื่องการค้นไม่พบใน summary, highlights หรือ tips ' +
  'แยกที่มาไว้ใน sources พร้อมชื่อหน้าและลิงก์ที่ค้นเจอจริง ไม่แทรกโดเมนหรือลิงก์ในข้อความ บอก confidence web เฉพาะเมื่อยืนยันได้ และระบุ photoPage ของสถานที่นี้โดยเฉพาะ ห้ามเดาข้อมูล';
const inFlight = new Map();
const completed = new Map();
const photoTtl = 30 * 60_000;
const emptyPhotoTtl = 60_000;
const maxCompleted = 128;

const sourceHost = String.raw`(?:https?:\/\/)?(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?:[/?#][^\s(),;]*)?`;
const parentheticalSource = new RegExp(String.raw`\s*\(\s*${sourceHost}(?:\s*[,;]\s*${sourceHost})*\s*\)`, 'gi');
function researchText(value, max = 120) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\(\s*\[[^\]]+\]\(https?:\/\/[^\s)]+\)\s*\)/gi, '');
  return placeText(text, Infinity).replace(parentheticalSource, '').trim().slice(0, max);
}
function researchList(values, max) {
  return list(values).map((value) => researchText(value, max)).filter(Boolean).slice(0, 5);
}
function normalizedStop(raw) {
  const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
  const n = placeText(raw?.n);
  if (!id || !n) throw bad('ไม่มีข้อมูลสถานที่ (stop.id, stop.n)');
  const venue = n.split(/\s+[—–·]\s+/u)[0];
  const sourceUrl = raw.src?.checked === 'web' && httpsUrl(raw.src.url);
  return {
    id,
    n,
    k: placeText(raw.k, 20),
    ll: !raw.place?.fallback && coordinates(raw.ll) ? raw.ll : undefined,
    note: placeText(raw.note, 300),
    query: placeText(raw.query) || placeText(raw.place?.query),
    aliases: boundedStrings([...(venue !== n ? [venue] : []), ...list(raw.aliases), ...list(raw.place?.aliases)], 8, 80),
    ...(sourceUrl ? { src: { url: sourceUrl, title: placeText(raw.src.title) } } : {}),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? { date: raw.date } : {}),
    ...(raw.meal ? { meal: placeText(raw.meal, 30) } : {}),
  };
}
const number = (value) =>
  typeof value === 'number'
    ? Number.isFinite(value)
      ? value
      : null
    : typeof value === 'string' && /^\s*\d+(?:,\d{3})*(?:\.\d+)?\s*$/.test(value)
      ? Number(value.replaceAll(',', ''))
      : null;
function dish(row, rate, defaultCurrency) {
  if (!row || typeof row !== 'object') return null;
  const name = researchText(row.name ?? row.n);
  if (!name) return null;
  const amount = number(row.priceLocal?.amount);
  const currency = placeText(row.priceLocal?.currency || defaultCurrency, 3).toUpperCase();
  const priceLocal =
    amount >= 0 && amount !== null && /^[A-Z]{3}$/.test(currency) ? { amount, currency } : undefined;
  let price = number(row.price);
  if (price !== null && price < 0) price = null;
  const conversion = number(row.rate ?? row.priceLocal?.rate ?? rate);
  if (priceLocal && (price === null || (price === amount && conversion > 0 && conversion < 0.5))) {
    if (currency === 'THB') price = amount;
    else if (conversion > 0) price = Math.round(amount * conversion);
  }
  const why = researchText(row.why ?? row.description, 180);
  return { name, price, ...(why ? { why } : {}), ...(row.veg === true ? { veg: true } : {}), ...(priceLocal ? { priceLocal } : {}) };
}
export function normalizeInfo(result, stop) {
  const value = result.value ?? {};
  const sources = [];
  const claimed = new Map(
    list(value.sources).map((s) => [httpsUrl(typeof s === 'string' ? s : s?.url), placeText(s?.title, 120)]),
  );
  const verified = new Set(
    [...(result.verified ?? []), ...(result.cited ?? [])].map(httpsUrl).filter(Boolean),
  );
  for (const href of [...(result.cited ?? []), ...claimed.keys(), ...verified]) {
    const url = httpsUrl(href);
    if (sources.length === 6) break;
    if (!url || !verified.has(url) || sources.some((source) => source.url === sourceIdentity(url))) continue;
    sources.push({
      url: sourceIdentity(url),
      title: claimed.get(url) || placeText(result.titles?.get(url), 120) || new URL(url).hostname,
      checked: 'web',
    });
  }
  const details = {
    what: researchText(value.details?.what, 400),
    highlights: researchList(value.details?.highlights, 160),
  };
  for (const key of ['price', 'hours', 'rating', 'booking', 'address']) {
    const text = researchText(value.details?.[key], key === 'hours' ? 80 : 180);
    if (text) details[key] = text;
  }
  const info = {
    summary: researchText(value.summary, 300) || 'ยังไม่มีข้อมูล',
    details,
    dishes:
      stop.k === 'food'
        ? list(value.dishes)
            .map((d) => dish(d, value.rate, value.currency))
            .filter(Boolean)
            .slice(0, 6)
        : [],
    sources,
    photos: [],
    confidence: value.confidence === 'web' && sources.length ? 'web' : 'estimate',
  };
  for (const [field, size] of [
    ['priceRange', 100],
    ['hours', 80],
    ['phone', 40],
  ]) {
    const text = researchText(value[field], size);
    if (text) info[field] = text;
  }
  const tips = researchList(value.tips, 180);
  if (tips.length) info.tips = tips;
  return info;
}
async function lookup(stop, city, ctx) {
  ctx.signal.throwIfAborted();
  ctx.step('Bop กำลังค้นรายละเอียดสถานที่');
  const finishPhotos = provider === 'fake' ? null : startPlacePhotos(stop, ctx.signal, photos => {
    ctx.emit({ type: 'photos', photos });
  });
  await requireReady();
  let knownMenu;
  if (provider !== 'fake' && stop.k === 'food' && stop.src) {
    ctx.step('กำลังอ่านหน้าเมนูที่เผยแพร่');
    knownMenu = await publishedMenu(stop, [], ctx.signal);
  }
  const input = { city, stop };
  if (knownMenu) input.publishedMenu = { page: knownMenu.page, dishes: knownMenu.dishes };
  const result = await model(researchPrompt, input, {
    ...ctx, operation:'research', searches:3, location:{city,country:cities[city]?.cc},
  });
  const info = normalizeInfo(result, stop);
  ctx.step(
    info.confidence === 'web'
      ? 'อ่านผลค้น ' + info.sources.length + ' หน้า'
      : 'ไม่พบข้อมูลที่เชื่อถือได้ ใช้ข้อมูลประมาณ',
  );
  if (provider !== 'fake') {
    const enrichMenu = stop.k === 'food' && (info.dishes.length < 3 || info.dishes.every(row => row.price == null && !row.priceLocal));
    if (!knownMenu && enrichMenu && info.sources.length) ctx.step('กำลังอ่านหน้าเมนูที่เผยแพร่');
    const [photos, menu] = await Promise.all([
      finishPhotos([result.value.photoPage, ...info.sources.map((s) => s.url)]),
      knownMenu || (enrichMenu && info.sources.length ? publishedMenu(stop, info.sources, ctx.signal) : null),
    ]);
    info.photos = photos;
    if (menu) {
      info.menuSource = menu.page;
      info.dishes = menu.dishes.map(row => dish(row, result.value.rate, result.value.currency));
      if (!info.sources.some(source => source.url === menu.page)) {
        info.sources = [{ url: menu.page, title: 'หน้าเมนูที่เผยแพร่', checked: 'web' }, ...info.sources].slice(0, 6);
      }
    }
  }
  return info;
}
function startLookup(key, stop, city, ctx) {
  const ctrl = new AbortController();
  const entry = { ctrl, listeners: new Set(), step: '', photos: [], promise: null };
  inFlight.set(key, entry);
  const shared = {
    ...ctx,
    signal: ctrl.signal,
    step(text) {
      entry.step = text;
      for (const listener of entry.listeners) listener.step(text);
    },
    emit(event) {
      if (event.type === 'photos') entry.photos = event.photos;
      for (const listener of entry.listeners) listener.emit?.(event);
    },
  };
  // Attach the first listener before emitting the initial step.
  entry.promise = Promise.resolve().then(() => lookup(stop, city, shared)).then(info => {
    if (!ctrl.signal.aborted && inFlight.get(key) === entry) {
      if (completed.size >= maxCompleted) completed.delete(completed.keys().next().value);
      completed.set(key, { info, expires: Date.now() + (info.photos.length ? photoTtl : emptyPhotoTtl) });
    }
    return info;
  }).finally(() => {
    if (inFlight.get(key) === entry) inFlight.delete(key);
    ctrl.abort();
  });
  return entry;
}
export async function placeInfo(input, ctx) {
  const start = performance.now();
  const { signal } = ctx;
  signal.throwIfAborted();
  const stop = normalizedStop(input?.stop);
  const city = placeText(input.city) || 'เชียงใหม่';
  const key = JSON.stringify([city, stop.id, stop.n, stop.k, stop.ll, stop.query, [...stop.aliases].sort(),
    sourceIdentity(stop.src?.url), stop.date, stop.meal]);
  const saved = completed.get(key);
  if (saved) {
    completed.delete(key);
    if (saved.expires > Date.now()) {
      completed.set(key, saved);
      ctx.step('ใช้ข้อมูลที่ค้นไว้แล้ว');
      if (saved.info.photos.length) ctx.emit?.({ type: 'photos', photos: saved.info.photos });
      return { info: saved.info, ms: Math.round(performance.now() - start), cached: true };
    }
  }
  let entry = inFlight.get(key);
  const shared = Boolean(entry);
  if (!entry) entry = startLookup(key, stop, city, ctx);
  entry.listeners.add(ctx);
  let onAbort;
  try {
    if (entry.step) ctx.step(entry.step);
    if (entry.photos.length) ctx.emit?.({ type: 'photos', photos: entry.photos });
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    const info = await Promise.race([entry.promise, cancelled]);
    return { info, ms: Math.round(performance.now() - start), ...(shared ? { cached: true } : { usage: ctx.usage }) };
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    entry.listeners.delete(ctx);
    if (!entry.listeners.size && inFlight.get(key) === entry) {
      inFlight.delete(key);
      entry.ctrl.abort();
    }
  }
}
