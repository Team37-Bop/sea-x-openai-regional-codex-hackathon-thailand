// Place photos without any API key:
//   1. Wikipedia page image (search by name, matched by coordinates or title) + Wikimedia Commons files near the
//      coordinates whose title matches the name. Credit = author · licence · Wikimedia Commons.
//   2. og:image of web pages found during research (page = that URL).
// Every URL must be https; data: URLs are dropped. Results are cached per key by the caller.
import { haversine } from '../src/plan.js';

// Wikimedia grants higher limits to clients whose User-Agent names a contact; set BOP_UA_CONTACT (URL or e-mail) to add one.
const UA = `Bop/0.1 (group-travel agent demo app${process.env.BOP_UA_CONTACT ? '; ' + process.env.BOP_UA_CONTACT : ''})`;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Wikimedia rate-limits anonymous API clients hard: at most 2 requests in flight, >= 250 ms apart,
// and after a 429 skip Wikimedia for 60 s (photos then come from og:image only).
let wmActive = 0, wmLast = 0, wmDownUntil = 0; const wmQueue = [];
const isWM = u => /(^|\.)(wikipedia|wikimedia|wikidata)\.org$/.test(new URL(u).hostname);
async function wmSlot() {
  if (Date.now() < wmDownUntil) throw new Error('wikimedia cooling down');
  if (wmActive >= 2) await new Promise(r => wmQueue.push(r));
  wmActive++;
  const wait = wmLast + 250 - Date.now(); wmLast = Math.max(Date.now(), wmLast + 250);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}
const wmDone = () => { wmActive--; const n = wmQueue.shift(); if (n) n(); };
async function get(url, opts = {}) {
  if (!isWM(url)) return getRetry(url, opts);
  await wmSlot();
  try { return await getRetry(url, opts); }
  catch (e) { if (/HTTP 429/.test(e.message)) wmDownUntil = Date.now() + 60_000; throw e; }
  finally { wmDone(); }
}
async function getRetry(url, opts = {}) {
  try { return await get1(url, opts); }
  catch (e) { if (opts.signal?.aborted || !/HTTP 429|HTTP 503/.test(e.message)) throw e; await new Promise(r => setTimeout(r, 1200)); return get1(url, opts); }
}
async function get1(url, { timeout = 6000, signal, ua = UA, accept = 'application/json', max = 0 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': ua, Accept: accept }, signal: ctl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (ua === BROWSER_UA && r.url && !publicHttps(r.url)) throw new Error('redirected off public https');
    if (!max) return accept.includes('json') ? await r.json() : await r.text();
    // read at most `max` bytes (HTML head is enough for og:image)
    const reader = r.body.getReader(); const dec = new TextDecoder(); let out = '';
    while (out.length < max) { const { done, value } = await reader.read(); if (done) break; out += dec.decode(value, { stream: true }); if (/<\/head>/i.test(out)) break; }
    reader.cancel().catch(() => {});
    return out;
  } finally { clearTimeout(t); signal?.removeEventListener('abort', onAbort); }
}

export function normalizeHttpsUrl(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim().replace(/&amp;/g, '&');
  const markdown = /!?\[[^\]]*\]\(\s*<?(https:\/\/[^\s>]+?)>?(?:\s+["'][^"']*["'])?\s*\)/i.exec(raw);
  const angle = /^<\s*(https:\/\/[^>\s]+)\s*>$/i.exec(raw);
  let candidate = markdown?.[1] || angle?.[1] || raw;
  if (!/^https:\/\//i.test(candidate)) candidate = (/https:\/\/[^\s<>"']+/i.exec(candidate) || [])[0] || '';
  candidate = candidate.replace(/[\])},.;!?]+$/, '');
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && !url.username && !url.password && url.href.length < 2000 ? url.href : '';
  } catch { return ''; }
}
export const httpsUrl = value => !!normalizeHttpsUrl(value);
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
const stripHtml = s => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function commonsInfo(titles, signal) {
  if (!titles.length) return [];
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  for (const [k, v] of Object.entries({ action: 'query', titles: titles.join('|'), prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '960',
    iiextmetadatafilter: 'Artist|LicenseShortName', format: 'json' })) u.searchParams.set(k, v);
  const j = await get(u, { signal });
  return Object.values(j.query?.pages || {}).map(p => {
    const ii = p.imageinfo && p.imageinfo[0]; if (!ii) return null;
    const md = ii.extmetadata || {};
    const artist = stripHtml(md.Artist && md.Artist.value).slice(0, 80) || 'ไม่ระบุผู้ถ่าย';
    const lic = stripHtml(md.LicenseShortName && md.LicenseShortName.value) || '';
    return { url: ii.thumburl || ii.url, thumb: ii.thumburl, credit: `${artist}${lic ? ' · ' + lic : ''} · Wikimedia Commons`, source: 'wikimedia', page: ii.descriptionurl, title: p.title };
  }).filter(x => x && httpsUrl(x.url) && /\.(jpe?g|png|webp)/i.test(x.title));
}

/** Only public https hosts (no localhost / IP literals / internal names): page URLs can come from model output. */
export function publicHttps(value) {
  try {
    const normalized = normalizeHttpsUrl(value);
    if (!normalized) return false;
    const x = new URL(normalized);
    if (x.protocol !== 'https:' || x.username || x.password || (x.port && x.port !== '443')) return false;
    const h = x.hostname.toLowerCase();
    return h.includes('.') && !/^[\d.]+$/.test(h) && !h.includes(':') && !/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(h);
  } catch { return false; }
}

/* ---------- strict place matching (a wrong photo is worse than no photo) ---------- */
const AREA_KINDS = new Set(['nature', 'market', 'area', 'sight']); // complexes / areas get the wider radius
const GENERIC = new Set(['the', 'of', 'and', 'a', 'an']);
/** Compact form for name comparison: case, diacritics, Vietnamese đ, punctuation, parentheticals removed. */
export const compact = x => fold(String(x || '').replace(/\([^)]*\)/g, ' ')).split(/[^a-z0-9฀-๿]+/).filter(w => w && !GENERIC.has(w)).join('');
/** Name variants: the display name, the OSM/English query, model-supplied aliases (any language). */
// Composite names ("Ba Na Hills & Golden Bridge", "วัดลิงอึ๋ง / Lady Buddha") also yield each part as a variant.
const parts = x => [x, ...String(x || '').split(/\s*(?:&|\/|\+|,|\(|\)|\s-\s|\sand\s|และ)\s*/i)];
export const variants = (...xs) => [...new Set(xs.flat().flatMap(parts).map(compact).filter(v => v.length >= 4))];
/** Same place name: equal compact forms, or one contains the other and covers >= 75 % of it. */
export function nameMatches(candidate, vars) {
  const c = compact(candidate);
  if (c.length < 4) return false;
  return vars.some(v => v === c || ((c.includes(v) || v.includes(c)) && Math.min(c.length, v.length) / Math.max(c.length, v.length) >= 0.75));
}
const within = (ll, c, km) => !!(ll && c && haversine(ll, c) <= km);

async function wikidataEntities(ids, signal) {
  if (!ids.length) return {};
  const u = new URL('https://www.wikidata.org/w/api.php');
  for (const [k, v] of Object.entries({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|aliases|claims', format: 'json' })) u.searchParams.set(k, v);
  return (await get(u, { signal })).entities || {};
}
const claimVal = (e, p) => { const c = e && e.claims && e.claims[p] && e.claims[p][0]; return c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value; };

/**
 * Wikimedia photo only when an article/item is about THIS place: its title or Wikidata label/alias (any language)
 * matches a name variant AND its coordinates are within 1.5 km (3 km for areas/complexes) of `ll`.
 * Uses the item's Wikidata P18 ('exact'); the article lead image is used only if its file name also names the place.
 */
export async function wikiPhotos({ name, query, aliases = [], ll, kind = '', signal, limit = 2 }) {
  if (!ll) return []; // no coordinates, no way to prove it is the same place
  const vars = variants(name, query, aliases);
  if (!vars.length) return [];
  const km = AREA_KINDS.has(kind) ? 3 : 1.5;
  const u = new URL('https://en.wikipedia.org/w/api.php');
  for (const [k, v] of Object.entries({ action: 'query', generator: 'search', gsrsearch: query || name, gsrlimit: '6', prop: 'pageimages|coordinates|pageprops',
    piprop: 'name', ppprop: 'wikibase_item', format: 'json' })) u.searchParams.set(k, v);
  const pages = Object.values((await get(u, { signal })).query?.pages || {}).sort((a, b) => a.index - b.index);
  const qids = pages.map(p => p.pageprops && p.pageprops.wikibase_item).filter(Boolean);
  const ents = await wikidataEntities(qids, signal).catch(() => ({}));
  const picks = [];
  for (const p of pages) {
    const e = ents[p.pageprops && p.pageprops.wikibase_item];
    const labels = e ? [...Object.values(e.labels || {}).map(x => x.value), ...Object.values(e.aliases || {}).flat().map(x => x.value)] : [];
    if (!(nameMatches(p.title, vars) || labels.some(l => nameMatches(l, vars)))) continue;
    const c = p.coordinates && p.coordinates[0] ? [p.coordinates[0].lat, p.coordinates[0].lon] : (() => { const v = claimVal(e, 'P625'); return v ? [v.latitude, v.longitude] : null; })();
    if (!within(ll, c, km)) continue;
    const p18 = claimVal(e, 'P18');
    if (p18) picks.push({ file: 'File:' + p18, match: 'exact' });
    else if (p.pageimage && nameMatches(p.pageimage.replace(/\.[a-z]+$/i, '').replace(/_/g, ' '), vars)) picks.push({ file: 'File:' + p.pageimage, match: 'exact' });
    break; // the first article that is about this place decides; never fall through to a related article
  }
  if (!picks.length) return [];
  const info = await commonsInfo(picks.map(x => x.file), signal);
  return info.slice(0, limit).map(({ title, ...x }) => ({ ...x, match: 'exact' }));
}

/* og:image only from pages that clearly name the place; skip logos / banners / small images. */
// Logos, icons and placeholders only: share images ("og-image", "opengraph") are usually the real photo.
const BAD_IMG = /logo|icon|avatar|placeholder|favicon|sprite|blank|no[-_]?image|default[-_]?(?:image|thumb|og)|og[-_]?generic|generic[-_]?(?:og|share|image)|\/cropped-[^/]*\.png/i;
function metaContent(html, re) { const m = re.exec(html); return m ? (/content=["']([^"']*)["']/i.exec(m[0]) || [])[1] : undefined; }
export async function ogImage(pageUrl, { signal, vars = [] } = {}) {
  pageUrl = normalizeHttpsUrl(pageUrl);
  if (!publicHttps(pageUrl)) return null;
  try {
    const html = await get(pageUrl, { signal, ua: BROWSER_UA, accept: 'text/html', max: 300_000, timeout: 5000 });
    const title = (/<title[^>]*>([^<]*)<\/title>/i.exec(html) || [])[1] || '';
    const ogTitle = metaContent(html, /<meta[^>]+property=["']og:title["'][^>]*>/i) || '';
    let path = ''; try { path = decodeURIComponent(new URL(pageUrl).pathname).replace(/[-_/]+/g, ' '); } catch { /* ignore */ }
    const names = c => vars.some(v => c && compact(c).includes(v));
    if (vars.length && !(names(title) || names(ogTitle) || names(path))) return null;
    let url = metaContent(html, /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/i);
    if (!url) return null;
    url = new URL(url.replace(/&amp;/g, '&'), pageUrl).href;
    if (!publicHttps(url) || !httpsUrl(url) || /\.svg(\?|$)/i.test(url) || BAD_IMG.test(url) || /%7B|%22|&quot;|[{}]|admin-ajax\.php|\/wp-admin\//i.test(url)) return null; // broken templated / dynamic endpoints
    const w = +metaContent(html, /<meta[^>]+property=["']og:image:width["'][^>]*>/i), h = +metaContent(html, /<meta[^>]+property=["']og:image:height["'][^>]*>/i);
    if ((w && w < 300) || (h && h < 300)) return null;
    const host = new URL(pageUrl).hostname.replace(/^www\./, '');
    return { url, credit: host, source: 'web', page: pageUrl, match: 'likely' };
  } catch { return null; }
}

/** Commons files taken within `radius` m whose title contains a distinctive word of the name ('likely'). */
export async function commonsNear({ name, query, aliases = [], ll, signal, radius = 300, limit = 1 }) {
  if (!ll) return [];
  const words = [...new Set([name, query, ...aliases].flatMap(x => fold(x).split(/[^a-z0-9\u0E00-\u0E7F]+/)))]
    .filter(w => w.length >= 4 && !['restaurant', 'quan', 'nha', 'hang', 'vietnam', 'danang', 'nang', 'beach', 'hotel', 'market', 'street', 'chay', 'vegetarian'].includes(w));
  if (!words.length) return [];
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  for (const [k, v] of Object.entries({ action: 'query', list: 'geosearch', gscoord: `${ll[0]}|${ll[1]}`, gsradius: String(radius), gsnamespace: '6', gslimit: '50', format: 'json' })) u.searchParams.set(k, v);
  const near = (await get(u, { signal })).query?.geosearch || [];
  const files = near.filter(f => { const t = fold(f.title); return words.some(w => t.includes(w)) && /\.(jpe?g|png|webp)$/i.test(f.title); }).map(f => f.title).slice(0, limit);
  return (await commonsInfo(files, signal)).map(({ title, ...x }) => ({ ...x, match: 'likely' }));
}

/** Exact Wikimedia matches first, then og:image of pages that name the place; 0-4 items, sorted by confidence. */
export async function photosFor({ name, query, aliases = [], ll, kind, pages = [], photoPage = '', signal, limit = 4, wiki }) {
  const out = [...(wiki || await wikiPhotos({ name, query, aliases, ll, kind, signal }).catch(() => []))];
  const vars = variants(name, query, aliases);
  // fetch the pages in parallel, keep their order (photoPage first)
  const pgs = [...new Set([photoPage, ...pages].filter(Boolean))].slice(0, 6);
  const found = await Promise.all(pgs.map(p => ogImage(p, { signal, vars })));
  for (const ph of found) { if (out.length >= limit) break; if (ph && !out.some(x => x.url === ph.url)) out.push(ph); }
  if (!out.length) out.push(...await commonsNear({ name, query, aliases, ll, signal }).catch(() => []));
  const rank = { exact: 0, likely: 1 };
  return out.map(x => ({
    ...x,
    url: normalizeHttpsUrl(x.url),
    ...(x.page ? { page: normalizeHttpsUrl(x.page) || x.page } : {}),
  })).filter(x => x.url).sort((a, b) => rank[a.match] - rank[b.match]).slice(0, limit);
}
