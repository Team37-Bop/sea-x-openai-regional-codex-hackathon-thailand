import { clock, coordinates, dateAt, distance, minutes, normTime, source, str } from './domain.mjs';
import { stopKind } from './stop-kinds.mjs';
import { fields, uniqueId } from './edits.mjs';
import { findPlace, legKey, route } from './geo.mjs';
import { catalogPlace } from './sample.mjs';
import { matchesPick } from './candidates.mjs';

export const isHotel = (s) => ['hotel', 'stay'].includes(stopKind(s?.k ?? s?.kind));
export const isTransit = (s) => ['terminal', 'transit'].includes(stopKind(s?.k ?? s?.kind));
const modes = ['walk', 'red', 'car', 'van', 'own', 'transit'];
export function dayHotels(stays, index, days) {
  const at = (night) => stays.find((s) => s.first <= night && night < s.first + s.nights);
  return { start: index > 0 ? at(index - 1) : null, end: index < days - 1 ? at(index) : null };
}
function anchor(rows, index, stays, days) {
  const { start, end } = dayHotels(stays, index, days);
  if (!rows.length || !stays.length) return rows;
  const usable = [start, end].filter((s) => coordinates(s?.ll));
  const pin = (row, hotel) => ({
    ...row,
    name: hotel.name,
    n: hotel.name,
    ll: hotel.ll,
    pinned: true,
    place: { source: hotel.locationSource ?? 'pick', ...(hotel.locationFallback && { fallback: true }) },
  });
  for (const [i, row] of rows.entries()) {
    if (!isHotel(row)) continue;
    const byName = usable.find((h) => h.name === (row.name ?? row.n));
    const hotel =
      byName ??
      (i === 0 && start && usable.includes(start) ? start : null) ??
      (coordinates(row.ll)
        ? [...usable].sort((a, b) => distance(row.ll, a.ll) - distance(row.ll, b.ll))[0]
        : usable.at(-1));
    if (hotel) rows[i] = pin(row, hotel);
  }
  if (coordinates(start?.ll)) {
    if (!isHotel(rows[0]) || rows[0].name !== start.name) {
      const t = clock(Math.max(360, minutes(normTime(rows[0].start) || '09:00') - 20));
      rows.unshift(
        pin(fields({ id: 'd' + (index + 1) + '_stay_start', kind: 'hotel', start: t, end: t, cost: 0 }), start),
      );
    }
    if (end && start.name !== end.name) rows[0].note = 'เช็กเอาต์ ขนกระเป๋าไป' + end.name;
    else if (index === days - 1) rows[0].note ||= 'เช็กเอาต์และนำสัมภาระ';
  }
  if (coordinates(end?.ll)) {
    if (!isHotel(rows.at(-1)) || rows.at(-1).name !== end.name) {
      const t = clock(Math.min(1410, minutes(normTime(rows.at(-1).end) || '18:00') + 30));
      rows.push(
        pin(fields({ id: 'd' + (index + 1) + '_stay_end', kind: 'hotel', start: t, end: t, cost: 0 }), end),
      );
    }
  }
  return rows;
}
export async function bookedStays(setup, ctx, offline) {
  if (setup.stay.mode !== 'booked') return [];
  let first = 0;
  const rows = setup.stay.stays.map((s) => {
    const row = {
      ...s,
      first,
      checkIn: dateAt(setup.startDate, first),
      checkOut: dateAt(setup.startDate, first + s.nights),
    };
    first += s.nights;
    return row;
  });
  return Promise.all(
    rows.map(async (s) => {
      let ll = coordinates(s.ll) ? s.ll : undefined;
      const words = s.name.split(/\s+/),
        names = [...new Set([s.name, words.slice(0, 3).join(' '), words.slice(0, 2).join(' ')])];
      if (!ll && !offline && coordinates(setup.cityLL))
        for (const radius of [40, 200]) {
          for (const name of names) {
            ll = await findPlace(radius === 40 ? name + ' ' + setup.city : name, setup.cityLL, radius, ctx.signal);
            if (ll) break;
          }
          if (ll) break;
        }
      ctx.step('ที่พักที่จองไว้: ' + s.name + ' · ' + (ll ? 'พบบนแผนที่' : 'ใช้พิกัดประมาณ'));
      return {
        ...s,
        ll: ll ?? (coordinates(setup.cityLL) ? setup.cityLL : undefined),
        locationSource: ll ? 'pick' : 'model',
        ...(!ll && { locationFallback: true }),
      };
    }),
  );
}
const round5 = (v) => 5 * Math.round(v / 5);
export function fare(mode, km, count, leg = {}) {
  count = Math.max(1, count);
  if (mode === 'walk') return 0;
  if (mode === 'own')
    return Math.round((4 * km) / Math.min(count, 5) + (Number(leg.parking) || 0) + (Number(leg.tolls) || 0));
  if (mode === 'red') return Math.max(20, round5(km * 5));
  if (mode === 'transit') return round5(35 + 3 * km);
  if (mode === 'van') return round5(((100 + 16 * km) * Math.ceil(count / 9)) / count);
  return round5(((60 + 14 * km) * Math.ceil(count / 4)) / count);
}
export async function concurrent(items, width, work) {
  let cursor = 0;
  const result = [];
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        result[i] = await work(items[i], i);
      }
    }),
  );
  return result;
}
export async function schedule(raw, index, setup, ctx, stays, verified, opts = {}) {
  const { keep = false, offline = false } = opts;
  const date = keep && /^\d{4}-\d{2}-\d{2}$/.test(raw?.date) ? raw.date : dateAt(setup.startDate, index);
  const title = str(raw?.title ?? raw?.label) || 'วันที่ ' + (index + 1);
  const rows = anchor(
    (Array.isArray(raw?.stops) ? raw.stops : [])
      .slice(0, 32)
      .filter((r) => r && str(r.name ?? r.n ?? r.catalogId ?? r.catalog))
      .map(fields),
    index,
    stays,
    setup.days,
  );
  const ids = new Set(),
    batch = { remaining: 8 };
  const stopIds = rows.map((row, i) => uniqueId(str(row.id, 80) || 'd' + (index + 1) + '_' + (i + 1), ids));
  const pins = [];
  const previewRoutes = {};
  function publishMap() {
    if (!ctx.signal?.aborted) {
      opts.onMap({
        type: 'map',
        index,
        day: { date, title, stops: pins.filter(Boolean) },
        routes: { ...previewRoutes },
      });
    }
  }
  const tGeo = performance.now();
  const placed = await concurrent(rows, 4, async (row, i) => {
    const cat = catalogPlace(setup.city, row);
    const name = str(row.name || cat?.name);
    const hint = coordinates(row.ll) ? row.ll : undefined;
    const pick = setup.picks?.must?.find((p) => coordinates(p.ll) && matchesPick({ ...row, name }, p, true));
    let ll, location;
    if (cat && !row.pinned && !pick) {
      ll = cat.ll;
      location = 'catalog';
    } else if (row.pinned) {
      ll = hint;
      location = row.place?.source ?? 'pick';
    } else if (pick) {
      ll = pick.ll;
      location = 'pick';
    } else if (keep && hint && row.place) {
      ll = hint;
      location = row.place.source;
    } else if (!offline && !opts.preResolved) {
      ll = await findPlace(
        (str(row.query) || name) + ' ' + setup.city,
        hint ?? setup.cityLL,
        hint ? 3 : 40,
        ctx.signal,
        batch,
      );
      if (ll) location = 'geocoded';
    }
    const k = stopKind(row.kind, cat?.kind);
    const stop = {
      ...row,
      id: stopIds[i],
      n: name,
      name,
      k,
      kind: k,
      ll: ll ?? hint,
      place: { ...row.place, source: location ?? 'model' },
      cost: Math.max(0, Number(row.cost ?? cat?.cost) || 0),
      walk: Math.max(0, Number(row.walk ?? row.walkKm) || 0),
    };
    if (row.src && !keep)
      stop.src =
        row.src.checked === 'web' ? source(row.src, verified) : { url: '', title: '', checked: 'estimate' };
    if (keep && row.src && row.place === undefined && row.src.checked === 'web')
      stop.src = source(row.src, verified);
    if (!row.src) delete stop.src;
    if (opts.onMap && coordinates(stop.ll) && !stop.place.fallback) {
      const source = stop.place.source;
      pins[i] = { id: stop.id, name, kind: k, ll: stop.ll, place: { source }, ordinal: i + 1 };
      publishMap();
    }
    return stop;
  });
  const geoMs = performance.now() - tGeo;
  for (const [i, s] of placed.entries()) {
    if (!coordinates(s.ll)) {
      s.ll = placed[i - 1]?.ll ?? (coordinates(setup.cityLL) ? setup.cityLL : [0.0001, 0.0001]);
      s.place.source = 'model';
      s.place.fallback = true;
      console.warn('Bop used approximate coordinates for ' + s.id);
    }
  }
  const tRoute = performance.now();
  const roads = await concurrent(placed, 3, async (s, i) => {
    if (!i) return null;
    const row = rows[i],
      prev = placed[i - 1];
    const mode = [row.mode, row.leg?.m, row.leg?.mode].find((v) => modes.includes(v)) ?? 'car';
    const moved = keep && row.leg?.key && row.leg.key !== legKey(prev.ll, s.ll, mode);
    const incoming = moved
      ? {}
      : { ...row.leg, min: row.legMin ?? row.leg?.min, minSrc: row.minSrc ?? row.leg?.minSrc };
    const road = await route(prev.ll, s.ll, mode, ctx.signal, offline, incoming);
    if (opts.onMap && pins[i - 1] && pins[i]) {
      // Bound repeated snapshot sizes. The completed day retains the original route geometry.
      const points = road.geom;
      const geom = points.length <= 32 ? points : Array.from({ length: 32 }, (_, n) =>
        points[Math.round(n * (points.length - 1) / 31)]);
      previewRoutes[road.key] = { geom, ...(!road.real && { approx: true }) };
      pins[i] = { ...pins[i], leg: { key: road.key, mode, real: road.real } };
      publishMap();
    }
    return { mode, moved, road };
  });
  const routes = {},
    stats = {};
  for (const [i, s] of placed.entries()) {
    const row = rows[i],
      prev = placed[i - 1];
    let planned = normTime(row.start) ? minutes(row.start) : 600 + i * 80;
    const dwell = normTime(row.end)
      ? Math.max(0, minutes(row.end) - planned)
      : Math.max(0, Number(row.dwell ?? row.stayMin ?? 60));
    if (!index && !i && setup.arrive?.time && (isTransit(s) || opts.fakeArrival))
      planned = minutes(setup.arrive.time);
    if (
      index === setup.days - 1 &&
      i === placed.length - 1 &&
      isTransit(s) &&
      setup.depart?.time &&
      ['flight', 'bus', 'train'].includes(setup.depart.by)
    ) {
      planned = minutes(setup.depart.time) - (setup.depart.by === 'flight' ? 90 : 40);
    }
    let start = planned;
    if (prev) {
      const { mode, moved, road } = roads[i];
      const old = row.leg ?? {};
      const rawCost = row.legCost ?? old.cost;
      const auto =
        moved ||
        old.autoPrice === true ||
        rawCost == null ||
        Number(rawCost) < 0 ||
        !Number.isFinite(Number(rawCost));
      const leg = {
        ...old,
        m: mode,
        mode,
        key: road.key,
        km: road.km,
        min: road.min,
        real: road.real,
        autoPrice: auto,
        parking: row.parking ?? old.parking,
        tolls: row.tolls ?? old.tolls,
        minSrc: row.minSrc ?? old.minSrc,
        geometry: road.geometry,
      };
      leg.cost =
        auto || ['own', 'walk'].includes(mode) ? fare(mode, road.km, setup.members.length, leg) : Number(rawCost);
      if (row.legSrc) leg.src = row.legSrc;
      s.leg = leg;
      routes[road.key] = { geom: road.geom, ...(road.real ? {} : { approx: true }) };
      stats[road.via] = (stats[road.via] ?? 0) + 1;
      start = Math.max(planned, minutes(prev.end) + road.min);
    } else delete s.leg;
    s.t0 = s.start = clock(start);
    s.t1 = s.end = clock(start + dwell);
  }
  if (!keep && index === 0) {
    const hotel = placed.find(isHotel);
    if (stays[0]?.cost && hotel) hotel.cost = stays[0].cost;
  }
  const localized = new Date(date + 'T12:00:00Z').toLocaleDateString('th-TH', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return {
    day: {
      date,
      title,
      label: str(raw?.label ?? raw?.title) || localized,
      short: str(raw?.short) || localized,
      stops: placed,
    },
    routes,
    stats,
    geoMs,
    routeMs: performance.now() - tRoute,
  };
}
