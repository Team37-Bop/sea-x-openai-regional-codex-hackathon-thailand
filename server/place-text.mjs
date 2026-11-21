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
