// Unit checks for the rain trigger (server/weather.mjs) with a recorded-shape Open-Meteo response; no network.
// Usage: node scripts/test-weather.mjs
process.env.BOP_WEATHER_DISK = '0';
delete process.env.OPEN_METEO_API_KEY;
const { runWeatherCheck, rainAlert, exposedStops } = await import('../server/weather.mjs');

let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail++; };

// recorded shape: hourly.time local (timezone=auto), values describe the preceding hour
function response(start, days, rainy = {}) {
  const time = [], precipitation = [], precipitation_probability = [], weather_code = [];
  for (let d = 0; d < days; d++) {
    const dt = new Date(start + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + d);
    const iso = dt.toISOString().slice(0, 10);
    for (let h = 0; h < 24; h++) {
      const t = `${iso}T${String(h).padStart(2, '0')}:00`, r = rainy[t] || [0, 5];
      time.push(t); precipitation.push(r[0]); precipitation_probability.push(r[1]); weather_code.push(r[0] ? 63 : 2);
    }
  }
  return { timezone: 'Asia/Bangkok', hourly: { time, precipitation, precipitation_probability, weather_code } };
}
let calls = [], mode = 'ok', fixture = null;
globalThis.fetch = async url => {
  calls.push(String(url));
  if (mode === 'down') throw new Error('timeout');
  if (mode === '429') return { ok: false, status: 429, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => fixture };
};

const now = new Date('2026-11-10T09:00:00+07:00');
const setup = { startDate: '2026-11-11', days: 2, members: [] };
const S = (id, n, x) => ({ id, n, k: 'sight', t0: '10:00', t1: '11:00', ll: [19.0646, 99.0757], ...x });
const plan = {
  days: [
    { stops: [S('hotel', 'โรงแรม', { k: 'stay' }), S('museum', 'พิพิธภัณฑ์', { t0: '14:00', t1: '16:00', ll: [18.79, 98.98] })] },
    { stops: [S('hotel', 'โรงแรม', { k: 'stay' }), S('buatong', 'น้ำตกบัวตอง', { k: 'nature', outdoor: 1, t0: '13:40', t1: '15:20' }),
      S('doi', 'จุดชมวิว', { k: 'view', t0: '17:00', t1: '18:00', ll: [18.8167, 98.894] })] },
  ],
};

// exposed stops only
const ex = exposedStops(plan, setup);
ok(ex.length === 2 && !ex.some(s => s.stopId === 'museum'), 'indoor museum not checked, nature + view checked');

// pure thresholds: value at 15:00 covers 14:00-15:00
ok(rainAlert([{ h: 15 * 60, mm: 4, prob: 80 }], 13 * 60 + 40, 15 * 60 + 20)?.level === 'heavy', 'heavy: 4 mm / 80 %');
const h = rainAlert([{ h: 15 * 60, mm: 4, prob: 80 }], 13 * 60 + 40, 15 * 60 + 20);
ok(h.from === '14:00' && h.to === '15:00' && h.mm === 4 && h.prob === 80, `heavy window 14:00-15:00 (${h.from}-${h.to})`);
ok(rainAlert([{ h: 15 * 60, mm: 1.2, prob: 72 }], 840, 900)?.level === 'heavy', 'heavy: 72 % with 1.2 mm');
ok(rainAlert([{ h: 15 * 60, mm: 0.6, prob: 55 }], 840, 900)?.level === 'likely', 'likely: 55 % with 0.6 mm');
ok(rainAlert([{ h: 15 * 60, mm: 0.4, prob: 90 }], 840, 900) === null, 'none: 90 % but 0.4 mm');
ok(rainAlert([{ h: 13 * 60, mm: 9, prob: 99 }], 840, 900) === null, 'rain outside the stop window ignored');

// endpoint: heavy at the waterfall on day 2 (2026-11-12)
fixture = response('2026-11-12', 2, { '2026-11-12T15:00': [4, 80], '2026-11-12T16:00': [0.7, 60] });
let out = await runWeatherCheck({ setup, plan, now });
ok(calls.length === 2, `one call per coordinate group (${calls.length})`);
ok(calls.every(u => u.startsWith('https://api.open-meteo.com/v1/forecast?') && !u.includes('apikey')), 'free host, no key');
const a = out.alerts.find(x => x.stopId === 'buatong');
ok(a && a.level === 'heavy' && a.from === '14:00' && a.to === '16:00' && a.day === 1 && a.source === 'open-meteo' && !a.trend, `waterfall heavy 14:00-16:00 day 2 (${JSON.stringify(a)})`);
ok(!out.reason && out.horizon.from === '2026-11-10' && out.horizon.to === '2026-11-25', 'horizon today..today+15');

// cached: no new calls
calls = [];
out = await runWeatherCheck({ setup, plan, now });
ok(calls.length === 0 && out.alerts.length === 1, 'second check served from cache');

// beyond horizon
out = await runWeatherCheck({ setup: { ...setup, startDate: '2026-12-10' }, plan: { days: plan.days.map(d => ({ ...d })) }, now });
ok(out.alerts.length === 0 && out.reason === 'beyond_horizon', 'trip in 30 days -> beyond_horizon');

// trend label beyond 3 days
calls = []; fixture = response('2026-11-19', 2, { '2026-11-19T15:00': [3, 60] });
out = await runWeatherCheck({ setup: { ...setup, startDate: '2026-11-18' }, plan, now });
ok(out.alerts[0]?.trend === true, 'alert 9 days out labelled trend');

// API down twice -> unavailable, breaker open
mode = 'down'; calls = [];
out = await runWeatherCheck({ setup: { ...setup, startDate: '2026-11-13' }, plan, now });
ok(out.alerts.length === 0 && out.reason === 'unavailable', 'API down -> alerts [] reason unavailable');
calls = [];
out = await runWeatherCheck({ setup: { ...setup, startDate: '2026-11-14' }, plan, now });
ok(calls.length === 0 && out.reason === 'unavailable', 'breaker skips Open-Meteo after two failures');

// commercial key -> commercial host (module state: breaker open, so test URL building via a fresh import)
process.env.OPEN_METEO_API_KEY = 'test-key';
mode = 'ok'; calls = []; fixture = response('2026-11-15', 2);
const fresh = await import('../server/weather.mjs?k=1');
await fresh.runWeatherCheck({ setup: { ...setup, startDate: '2026-11-15' }, plan, now });
ok(calls.length > 0 && calls.every(u => u.startsWith('https://customer-api.open-meteo.com/') && u.includes('apikey=test-key')), 'OPEN_METEO_API_KEY -> commercial host');

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
