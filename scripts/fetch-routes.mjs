// Fetch real road routes for every leg in the base plan and all scenario variants.
// Usage: node scripts/fetch-routes.mjs   -> writes src/routes.json
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { BASE, SCEN, clone, allLegs, legKey, OSRM_PROFILE } from '../src/plan.js';

const OUT = new URL('../src/routes.json', import.meta.url);
const routes = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};

// base + every option of every scenario, plus scenario-on-scenario combos
const plans = [clone(BASE)];
const keys = Object.keys(SCEN);
for (const k of keys) for (const o of SCEN[k].options) { const p = clone(BASE); o.build(p); plans.push(p); }
for (const k1 of keys) for (const k2 of keys) {
  const p = clone(BASE); SCEN[k1].options[0].build(p);
  const s2 = SCEN[k2];
  const ok = p.days.some(d => d.stops.some(s => s.id === s2.need)) && (!s2.applicable || s2.applicable(p));
  if (ok) for (const o of s2.options) { const q = clone(p); o.build(q); plans.push(q); }
}

const todo = new Map();
for (const p of plans) for (const l of allLegs(p)) { const k = legKey(l.a, l.b, l.m); if (!routes[k]) todo.set(k, l); }
console.log(`${Object.keys(routes).length} cached, ${todo.size} to fetch`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const [k, l] of todo) {
  const url = `https://routing.openstreetmap.de/${OSRM_PROFILE[l.m]}/route/v1/driving/${l.a[1]},${l.a[0]};${l.b[1]},${l.b[0]}?overview=full&geometries=geojson`;
  try {
    const j = await (await fetch(url)).json();
    const r = j.routes && j.routes[0];
    if (r) {
      routes[k] = { dur: Math.round(r.duration), dist: Math.round(r.distance),
        geom: r.geometry.coordinates.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]) };
      console.log(`ok  ${l.m.padEnd(4)} ${(r.distance/1000).toFixed(1)} km  ${(r.duration/60).toFixed(0)} min`);
    } else console.log(`no route ${k}`);
  } catch (e) { console.log(`fail ${k}: ${e.message}`); }
  await sleep(300);
}
writeFileSync(OUT, JSON.stringify(routes));
console.log(`wrote ${Object.keys(routes).length} routes`);
