import { clock, coordinates, dateAt, minutes, validTime } from './domain.mjs';
const cache = new Map(),
  pending = new Map();
let failures = 0,
  blocked = 0;
const ident = (point, date) => point + '|' + date;
function waitForForecast(shared, signal) {
  shared.waiters++;
  return new Promise((resolve, reject) => {
    let waiting = true;
    function detach() {
      if (!waiting) return false;
      waiting = false;
      shared.waiters--;
      signal.removeEventListener('abort', cancel);
      return true;
    }
    function cancel() {
      if (!detach()) return;
      if (!shared.waiters) shared.controller.abort();
      reject(signal.reason);
    }
    shared.promise.then(
      (result) => { if (detach()) resolve(result); },
      (error) => { if (detach()) reject(error); },
    );
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
}

async function load(point, dates, today, signal) {
  signal.throwIfAborted();
  const missing = dates.filter((date) => (cache.get(ident(point, date))?.until ?? 0) <= Date.now());
  if (!missing.length) return true;
  const active = new Set();
  const next = [];
  for (const date of missing) {
    const current = pending.get(ident(point, date));
    if (current && !current.controller.signal.aborted) active.add(current);
    else next.push(date);
  }
  if (next.length) {
    const controller = new AbortController();
    const shared = { controller, waiters: 0, promise: null };
    const work = (async () => {
      if (blocked > Date.now()) return false;
      const [latitude, longitude] = point.split(',');
      const key = process.env.OPEN_METEO_API_KEY;
      const url = new URL(
        key ? 'https://customer-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast',
      );
      url.search = new URLSearchParams({
        latitude,
        longitude,
        timezone: 'auto',
        hourly: 'precipitation,precipitation_probability',
        start_date: next[0],
        end_date: dateAt(next.at(-1), 1),
        ...(key ? { apikey: key } : {}),
      });
      try {
        const res = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
        if (res.status === 429) blocked = Date.now() + 600000;
        if (!res.ok) throw Error('Weather ' + res.status);
        const data = (await res.json()).hourly;
        controller.signal.throwIfAborted();
        if (
          !Array.isArray(data?.time) ||
          !Array.isArray(data.precipitation) ||
          !Array.isArray(data.precipitation_probability)
        )
          throw Error('Invalid forecast');
        const fetchedAt = new Date().toISOString();
        const hourly = new Map(next.map((date) => [date, []]));
        for (const [i, time] of data.time.entries()) {
          if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(time)) continue;
          const hh = time.slice(11, 16),
            end = minutes(hh) || 1440;
          const date = hh === '00:00' ? dateAt(time.slice(0, 10), -1) : time.slice(0, 10);
          if (
            !hourly.has(date) ||
            !Number.isFinite(data.precipitation[i]) ||
            !Number.isFinite(data.precipitation_probability[i])
          )
            continue;
          hourly
            .get(date)
            .push({
              from: end - 60,
              to: end,
              mm: data.precipitation[i],
              prob: data.precipitation_probability[i],
            });
        }
        for (const [date, rows] of hourly) {
          if (cache.size >= 1500) cache.delete(cache.keys().next().value);
          cache.set(ident(point, date), {
            rows,
            fetchedAt,
            until: Date.now() + (date <= dateAt(today, 2) ? 3600000 : 10800000),
          });
        }
        failures = 0;
        return true;
      } catch {
        controller.signal.throwIfAborted();
        if (++failures >= 2) {
          failures = 0;
          blocked = Date.now() + 600000;
        }
        return false;
      }
    })();
    shared.promise = work.finally(() => {
      for (const date of next) {
        const key = ident(point, date);
        if (pending.get(key) === shared) pending.delete(key);
      }
    });
    for (const date of next) pending.set(ident(point, date), shared);
    active.add(shared);
  }
  return (await Promise.all([...active].map((shared) => waitForForecast(shared, signal)))).every(Boolean);
}
export async function weather(
  plan,
  signal = new AbortController().signal,
  today = new Date().toISOString().slice(0, 10),
  setup = plan.setup,
) {
  const horizon = { from: today, to: dateAt(today, 15) };
  const groups = new Map(),
    alerts = [];
  let exposed = 0,
    within = 0,
    checked = 0,
    failed = false;
  for (const [index, day] of (plan.days ?? []).entries()) {
    const date = day.date || (setup?.startDate && dateAt(setup.startDate, index));
    for (const stop of day.stops ?? []) {
      const start = stop.t0 ?? stop.start,
        end = stop.t1 ?? stop.end;
      if (
        !coordinates(stop.ll) ||
        !(stop.outdoor || ['nature', 'view'].includes(stop.k ?? stop.kind)) ||
        !validTime(start) ||
        !validTime(end) ||
        minutes(end) <= minutes(start) ||
        !date
      )
        continue;
      exposed++;
      if (date < today || date > horizon.to) continue;
      within++;
      const point = stop.ll.map((v) => v.toFixed(2)).join(',');
      if (!groups.has(point)) groups.set(point, []);
      groups.get(point).push({ stop, index, date, start: minutes(start), end: minutes(end) });
    }
  }
  const queue = [...groups.entries()];
  async function worker() {
    while (queue.length) {
      const [point, stops] = queue.shift();
      const success = await load(point, [...new Set(stops.map((s) => s.date))].sort(), today, signal);
      if (!success) failed = true;
      for (const { stop, index, date, start, end } of stops) {
        const entry = cache.get(ident(point, date));
        if (!entry) continue;
        checked++;
        const wet = entry.rows.filter(
          (h) =>
            h.from < end &&
            h.to > start &&
            (h.mm >= 2.5 || (h.mm >= 1 && h.prob >= 70) || (h.prob >= 50 && h.mm >= 0.5)),
        );
        if (!wet.length) continue;
        const to = Math.max(...wet.map((h) => h.to));
        alerts.push({
          stopId: stop.id,
          n: stop.n ?? stop.name,
          day: index,
          date,
          level: wet.some((h) => h.mm >= 2.5 || (h.mm >= 1 && h.prob >= 70)) ? 'heavy' : 'likely',
          from: clock(Math.min(...wet.map((h) => h.from))),
          to: to === 1440 ? '24:00' : clock(to),
          mm: Math.round(Math.max(...wet.map((h) => h.mm)) * 10) / 10,
          prob: Math.max(...wet.map((h) => h.prob)),
          trend: date > dateAt(today, 3),
          source: 'open-meteo',
          fetchedAt: entry.fetchedAt,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, groups.size) }, worker));
  alerts.sort(
    (a, b) =>
      a.day - b.day ||
      Number(b.level === 'heavy') - Number(a.level === 'heavy') ||
      a.from.localeCompare(b.from),
  );
  const reason = !exposed
    ? 'no_exposed'
    : !within
      ? 'beyond_horizon'
      : !checked
        ? 'unavailable'
        : within < exposed
          ? 'partial_horizon'
          : undefined;
  return { alerts, horizon, source: 'open-meteo', checked, failed, ...(reason ? { reason } : {}) };
}
