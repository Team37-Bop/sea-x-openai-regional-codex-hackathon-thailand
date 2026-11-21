import { bad, cities, coordinates } from './domain.mjs';
import { model, provider, requireReady } from './model.mjs';
import { collectPhotos, exactPhoto } from './photos.mjs';
import { boundedStrings, httpsUrl, list, placeText } from './place-text.mjs';

const researchPrompt =
  'ค้นหาสถานที่จริงให้ตรงชื่อ สาขา เมืองและพิกัด จากเว็บอย่างมากสามครั้ง สรุปเป็นภาษาไทย what, highlights, ราคา เวลาเปิด เรตติ้ง การจอง ที่อยู่ โทรศัพท์และเคล็ดลับตามหลักฐาน ' +
  'ร้านอาหารให้แนะนำเมนูจริงพร้อมราคา THB ต่อจานและ priceLocal {amount,currency} และ rate จำนวนบาทต่อหนึ่งหน่วยท้องถิ่น ถ้าหาไม่ได้ให้เว้น ' +
  'คืน sources พร้อมชื่อหน้าและลิงก์ที่ค้นเจอจริง บอก confidence web เฉพาะเมื่อยืนยันได้ และระบุ photoPage หน้าเว็บที่มีรูปสถานที่จริง ห้ามเดาข้อมูล';
const lookups = new Map();

function normalizedStop(raw) {
  const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
  const n = placeText(raw?.n);
  if (!id || !n) throw bad('ไม่มีข้อมูลสถานที่ (stop.id, stop.n)');
  return {
    id,
    n,
    k: placeText(raw.k, 20),
    ll: coordinates(raw.ll) ? raw.ll : undefined,
    note: placeText(raw.note, 300),
    query: placeText(raw.query) || placeText(raw.place?.query),
    aliases: boundedStrings([...list(raw.aliases), ...list(raw.place?.aliases)], 8, 80),
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
  const name = placeText(row.name ?? row.n);
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
  const why = placeText(row.why ?? row.description, 180);
  return { name, price, ...(why ? { why } : {}), ...(priceLocal ? { priceLocal } : {}) };
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
    if (!url || !verified.has(url) || sources.some((source) => source.url === url)) continue;
    sources.push({
      url,
      title: claimed.get(url) || placeText(result.titles?.get(url), 120) || new URL(url).hostname,
      checked: 'web',
    });
  }
  const details = {
    what: placeText(value.details?.what, 400),
    highlights: boundedStrings(value.details?.highlights, 5, 160),
  };
  for (const key of ['price', 'hours', 'rating', 'booking', 'address']) {
    const text = placeText(value.details?.[key], key === 'hours' ? 80 : 180);
    if (text) details[key] = text;
  }
  const info = {
    summary: placeText(value.summary, 300) || 'ยังไม่มีข้อมูล',
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
    const text = placeText(value[field], size);
    if (text) info[field] = text;
  }
  const tips = boundedStrings(value.tips, 5, 180);
  if (tips.length) info.tips = tips;
  return info;
}
async function lookup(stop, city, ctx) {
  await requireReady();
  ctx.step('Bop กำลังค้นรายละเอียดสถานที่');
  const exact = provider === 'fake' ? Promise.resolve(null) : exactPhoto(stop, ctx.signal);
  exact.catch(() => {});
  const result = await model(researchPrompt, { city, stop }, {
    ...ctx, operation:'research', searches:3, location:{city,country:cities[city]?.cc},
  });
  const info = normalizeInfo(result, stop);
  ctx.step(
    info.confidence === 'web'
      ? 'อ่านผลค้น ' + info.sources.length + ' หน้า'
      : 'ไม่พบข้อมูลที่เชื่อถือได้ ใช้ข้อมูลประมาณ',
  );
  if (provider !== 'fake')
    info.photos = await collectPhotos(
      stop,
      [result.value.photoPage, ...info.sources.map((s) => s.url)],
      exact,
      ctx.signal,
    );
  return info;
}
export async function placeInfo(input, ctx) {
  const start = performance.now();
  const stop = normalizedStop(input?.stop);
  const key = JSON.stringify([stop.id, stop.n]);
  let entry = lookups.get(key);
  const cached = Boolean(entry);
  if (cached) ctx.step('ใช้ข้อมูลที่ค้นไว้แล้ว');
  else {
    const ctrl = new AbortController();
    entry = { ctrl, clients: 0, finished: false };
    entry.promise = lookup(stop, placeText(input.city) || 'เชียงใหม่', { ...ctx, signal: ctrl.signal })
      .catch((error) => {
        if (lookups.get(key) === entry) lookups.delete(key);
        throw error;
      })
      .finally(() => {
        entry.finished = true;
        ctrl.abort();
      });
    lookups.set(key, entry);
  }
  entry.clients++;
  const signal = ctx.signal;
  let onAbort;
  try {
    signal.throwIfAborted();
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    const info = await Promise.race([entry.promise, cancelled]);
    return {
      info,
      ms: Math.round(performance.now() - start),
      ...(cached ? { cached: true } : { usage: ctx.usage }),
    };
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (--entry.clients === 0 && !entry.finished) {
      lookups.delete(key);
      entry.ctrl.abort();
      entry.promise.catch(() => {});
    }
  }
}
