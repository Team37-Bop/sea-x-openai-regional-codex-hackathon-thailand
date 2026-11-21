export function rawUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const link = trimmed.match(/^!?\[[^\]]*\]\(\s*<?(https:\/\/[^\s>]+?)>?(?:\s+["'][^"']*["'])?\s*\)$/i);
  return link?.[1] ?? trimmed.replace(/^<([^<>]+)>$/, '$1');
}

export function httpsUrl(value) {
  try {
    const raw = rawUrl(value);
    if (!/^https:\/\//i.test(raw) || /[\u0000-\u0020\\]/.test(raw)) return '';
    const url = new URL(raw);
    if (url.protocol === 'https:' && !url.username && !url.password && url.href.length < 2000)
      return url.href;
  } catch {
    /* Unusable link. */
  }
  return '';
}

export function sourceIdentity(value) {
  const href = httpsUrl(value);
  if (!href) return '';
  const url = new URL(href);
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}

export function placeText(value, max = 120) {
  return typeof value === 'string'
    ? value
        .replace(/!?\[([^\]]*)\]\((?:https?:\/\/|<https?:\/\/)[^)]*\)/gi, '$1')
        .replace(/<(https?:\/\/[^>]+)>/gi, '$1')
        .trim()
        .slice(0, max)
    : '';
}

export const list = (value) => (Array.isArray(value) ? value : []);
export const boundedStrings = (values, limit, length) =>
  list(values)
    .map((v) => placeText(v, length))
    .filter(Boolean)
    .slice(0, limit);

export const plainAddress = value => String(value || '').normalize('NFKD').toLowerCase()
  .replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const streetNumber = /^(\d+(?:\s+[a-z](?=\s)|[\p{L}]?)(?:\s*[-–]\s*\d+[\p{L}]?)?)\s+(.+)$/iu;
export function numberedStreet(parts) {
  return parts.slice(1).map(part => part.trim().match(streetNumber)).find(Boolean);
}
export function addressedBranch(stop) {
  if (typeof stop.query !== 'string' || !['food', 'cafe', 'restaurant', 'hotel', 'stay'].includes(stop.kind || stop.k)) return;
  const [brand, branch] = String(stop.name || stop.n || '').split(/\s+[—–]\s+/);
  if (!branch) return;
  const parts = stop.query.split(',');
  const name = plainAddress(parts[0]);
  if ((name === plainAddress(brand) || name === plainAddress(brand + ' ' + branch)) && numberedStreet(parts)) return brand;
}
