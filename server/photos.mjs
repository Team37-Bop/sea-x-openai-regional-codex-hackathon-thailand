import { coordinates, distance } from './domain.mjs';

const cache = new Map();
let blockedUntil = 0;
let afterLast = 0;
let queue = Promise.resolve();

const label = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
function media(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'upload.wikimedia.org' && !url.username && !url.password) return url.href;
  } catch { /* No usable media URL. */ }
}
export async function wikipediaPhoto(name, ll, lang, signal) {
  if (!name || !coordinates(ll)) return null;
  const key = [name, ...ll.map(value => value.toFixed(3)), lang].join('|');
  if (cache.has(key)) return cache.get(key);
  const result = queue.then(async () => {
    signal.throwIfAborted();
    if (cache.has(key)) return cache.get(key);
    if (blockedUntil > Date.now()) return null;
    const wait = Math.max(0, afterLast - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    signal.throwIfAborted();
    afterLast = Date.now() + 250;
    const url = new URL('https://' + (lang === 'th' ? 'th' : 'en') + '.wikipedia.org/w/api.php');
    for (const [param, value] of Object.entries({ action: 'query', format: 'json', redirects: '1',
      titles: name, prop: 'coordinates|pageimages|info', inprop: 'url', pithumbsize: '640', pilicense: 'free' })) url.searchParams.set(param, value);
    let photo = null;
    try {
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(2500)]),
        headers: { 'User-Agent': 'BopTripPlanner/1.0 place photo lookup' } });
      if (response.status === 429) blockedUntil = Date.now() + 60_000;
      if (!response.ok) return null;
      const pages = (await response.json()).query?.pages ?? {};
      for (const record of Object.values(pages)) {
        const origin = record.coordinates?.[0];
        const thumb = media(record.thumbnail?.source);
        if (!origin || !thumb || label(record.title) !== label(name) || distance(ll, [origin.lat, origin.lon]) > 1.5) continue;
        if (record.thumbnail.width < 300 || !record.fullurl?.startsWith(url.origin + '/')) continue;
        photo = { url: thumb, credit: 'Wikimedia Commons · ดูเครดิตและสัญญาอนุญาตที่หน้าต้นทาง',
          source: 'wikimedia', page: record.fullurl, match: 'exact' };
        break;
      }
    } catch { signal.throwIfAborted(); return null; }
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(key, photo);
    return photo;
  });
  queue = result.catch(() => {});
  return result;
}
