import { containsName, namesVenue, publicPage, readPublicDocument } from './photos.mjs';
import { placeText, sourceIdentity } from './place-text.mjs';

const rows = (value) => Array.isArray(value) ? value : value ? [value] : [];
const menuPath = (value) => /(?:^|[/_-])menus?(?:[/_.?#-]|$)|เมนู/i.test(new URL(value).pathname);
const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const menuKeys = ['@graph', 'mainEntity', 'hasMenu', 'hasMenuSection', 'hasMenuItem'];
const indexKeys = [...menuKeys, 'itemListElement', 'item'];
const venueTypes = new Set(['Restaurant', 'FoodEstablishment', 'CafeOrCoffeeShop', 'BarOrPub', 'Bakery',
  'FastFoodRestaurant', 'Brewery', 'Winery', 'Distillery', 'IceCreamShop']);
const nodeTypes = node => rows(node['@type']).map(type => String(type).split('/').pop());

function structuredDishes(html, stop) {
  const roots = [];
  for (const script of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { roots.push(...rows(JSON.parse(script[1]))); } catch { /* Other scripts may contain the menu. */ }
  }
  const byId = new Map();
  const venues = new Map();
  const menus = [];
  function index(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 12) return;
    if (node['@id'] && Object.keys(node).some(key => key !== '@id' && key !== '@type')) byId.set(node['@id'], node);
    const types = nodeTypes(node);
    if (types.includes('Menu')) menus.push(node);
    if (node.hasMenu || types.some(type => venueTypes.has(type))) venues.set(node['@id'] || node, node);
    for (const key of indexKeys) {
      for (const child of rows(node[key])) index(child, depth + 1);
    }
  }
  for (const root of roots) index(root);
  const owners = [...venues.values()];
  const matches = owners.filter(venue => containsName(venue.name, stop));
  const unambiguous = !owners.length || (owners.length === 1 && (!owners[0].name || matches.length === 1));
  const dishes = new Map();
  const visited = new Map();
  const date = new Date((stop.date || '') + 'T12:00:00Z');
  const day = weekdays[date.getUTCDay()];
  function visit(node, section = '', depth = 0) {
    if (typeof node === 'string') node = byId.get(node);
    if (!node || typeof node !== 'object' || depth > 12) return;
    if (node['@id']) node = byId.get(node['@id']) || node;
    const types = nodeTypes(node);
    const sections = visited.get(node) || new Set();
    if (sections.has(section)) return;
    sections.add(section);
    visited.set(node, sections);
    if (types.includes('MenuSection')) section = placeText(node.name, 80);
    if (types.includes('MenuItem')) {
      const name = placeText(node.name);
      if (!name) return;
      const offer = rows(node.offers).find(item => item && /^[A-Z]{3}$/.test(item.priceCurrency) &&
        /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(item.price)));
      const veg = rows(node.suitableForDiet).some(v => /(?:^|\/)(?:Vegetarian|Vegan)Diet$/i.test(v));
      const label = section.toLowerCase();
      const special = weekdays.find(weekday => label.includes(weekday));
      if (special && day && special !== day) return;
      const main = /\bmains?\b|main course|จานหลัก/i.test(label);
      const priority = special && special === day ? 3 : main ? 2 : 1;
      if (dishes.has(name) && dishes.get(name).priority >= priority) return;
      dishes.set(name, {
        priority,
        dish: { name, price: null, ...(section ? { why: 'จากเมนูหมวด ' + section + ' ของร้าน' } : {}),
          ...(offer ? { priceLocal: { amount: Number(offer.price), currency: offer.priceCurrency } } : {}),
          ...(veg ? { veg: true } : {}) },
      });
      return;
    }
    for (const key of menuKeys) {
      for (const child of rows(node[key])) visit(child, section, depth + 1);
    }
  }
  // A directory may publish several menus and unrelated items in one graph.
  if (matches.length === 1 && matches[0].hasMenu) {
    for (const menu of rows(matches[0].hasMenu)) visit(menu);
  } else if (unambiguous) {
    for (const root of menus.length ? menus : roots) visit(root);
  }
  const ranked = [...dishes.values()].sort((a,b) => b.priority - a.priority);
  return { dishes: ranked.slice(0, 6).map(row => row.dish), unambiguous };
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
  let { dishes, unambiguous } = structuredDishes(doc.text, stop);
  if (unambiguous && !dishes.length && /<script\b[^>]*\bsrc\s*=\s*["']https:\/\/menus\.tenkites\.com\//i.test(doc.text)) {
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
        if (typeof html === 'string') dishes = structuredDishes(html, stop).dishes;
      }
    }
  }
  return { dishes, page: doc.page, linked: unambiguous ? menuLink(doc.text, doc.page) : '' };
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
