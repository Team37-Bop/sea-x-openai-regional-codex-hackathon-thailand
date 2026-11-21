import { namesVenue, publicPage, readPublicDocument } from './photos.mjs';
import { placeText, sourceIdentity } from './place-text.mjs';

const rows = (value) => Array.isArray(value) ? value : value ? [value] : [];
const menuPath = (value) => /(?:^|[/_-])menus?(?:[/_.?#-]|$)|เมนู/i.test(new URL(value).pathname);
const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function structuredDishes(html, stop) {
  const dishes = [];
  const seen = new Set();
  const date = new Date((stop.date || '') + 'T12:00:00Z');
  const day = weekdays[date.getUTCDay()];
  function visit(node, section = '', depth = 0) {
    if (!node || typeof node !== 'object' || depth > 12 || dishes.length >= 180) return;
    const types = rows(node['@type']).map(type => String(type).split('/').pop());
    if (types.includes('MenuSection')) section = placeText(node.name, 80);
    if (types.includes('MenuItem')) {
      const name = placeText(node.name);
      if (!name || seen.has(name)) return;
      seen.add(name);
      const offer = rows(node.offers).find(item => item && /^[A-Z]{3}$/.test(item.priceCurrency) &&
        /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(item.price)));
      const veg = rows(node.suitableForDiet).some(v => /(?:^|\/)(?:Vegetarian|Vegan)Diet$/i.test(v));
      const label = section.toLowerCase();
      const special = weekdays.find(weekday => label.includes(weekday));
      if (special && day && special !== day) return;
      const main = /\bmains?\b|main course|จานหลัก/i.test(label);
      dishes.push({
        priority: special && special === day ? 3 : main ? 2 : 1,
        dish: { name, price: null, ...(section ? { why: 'จากเมนูหมวด ' + section + ' ของร้าน' } : {}),
          ...(offer ? { priceLocal: { amount: Number(offer.price), currency: offer.priceCurrency } } : {}),
          ...(veg ? { veg: true } : {}) },
      });
      return;
    }
    for (const key of ['@graph', 'hasMenu', 'hasMenuSection', 'hasMenuItem', 'mainEntity']) {
      for (const child of rows(node[key])) visit(child, section, depth + 1);
    }
  }
  for (const script of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try {
      for (const root of rows(JSON.parse(script[1]))) visit(root);
    } catch { /* Other structured data on the page may still contain the menu. */ }
  }
  return dishes.sort((a,b) => b.priority - a.priority).slice(0, 6).map(row => row.dish);
}

function menuLink(html, page) {
  for (const match of html.matchAll(/<a\b[^>]*?\shref\s*=\s*["']([^"'<>]+)["']/gi)) {
    let url;
    try { url = new URL(match[1], page); } catch { continue; }
    if (url.origin === new URL(page).origin && menuPath(url) && !/\.pdf$/i.test(url.pathname)) return url.href;
  }
  return '';
}
async function readMenu(page, stop, signal) {
  const doc = await readPublicDocument(page, signal, { headOnly: false, limit: 750_000 });
  if (!doc || !namesVenue(doc.text.split(/<\/head\s*>/i)[0], doc.page, stop)) return null;
  let dishes = structuredDishes(doc.text, stop);
  if (!dishes.length && /<script\b[^>]*\bsrc\s*=\s*["']https:\/\/menus\.tenkites\.com\//i.test(doc.text)) {
    // Ten Kites embeds its schema.org Menu in a JSON-wrapped HTML document on the venue's own origin.
    const linked = doc.text.match(/\burl\s*:\s*["'](\/api\/tenkites\?menuId=[\w-]+)["']/i)?.[1];
    if (linked) {
      const embed = await readPublicDocument(new URL(linked, doc.page).href, signal,
        { headOnly: false, limit: 1_000_000, json: true });
      if (embed && new URL(embed.page).origin === new URL(doc.page).origin) {
        let html = embed.text;
        if (html.trimStart().startsWith('"')) {
          try { html = JSON.parse(html); } catch { html = ''; }
        }
        if (typeof html === 'string') dishes = structuredDishes(html, stop);
      }
    }
  }
  return { dishes, page: doc.page, linked: menuLink(doc.text, doc.page) };
}
export async function publishedMenu(stop, sources, signal) {
  const checked = publicPage(stop.src?.url);
  const pages = [...new Set(sources.map(s => sourceIdentity(s.url)).filter(publicPage).filter(menuPath))];
  if (checked) {
    const origin = new URL(checked).origin;
    pages.sort((a,b) => Number(new URL(b).origin === origin) - Number(new URL(a).origin === origin));
    if (!pages.includes(checked)) pages.push(checked);
  }
  const visited = new Set();
  while (pages.length && visited.size < 3) {
    const page = pages.shift();
    if (visited.has(page)) continue;
    visited.add(page);
    const result = await readMenu(page, stop, signal);
    if (result?.dishes.length) return result;
    if (result?.linked && !visited.has(result.linked)) pages.unshift(result.linked);
  }
  return null;
}
