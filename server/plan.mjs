import { stopKinds, stopKind } from './stop-kinds.mjs';
import {
  bad,
  checks,
  cities,
  clock,
  coordinates,
  dateAt,
  explain,
  minutes,
  normalize,
  source,
  str,
  total,
  transportOption,
  validTime,
} from './domain.mjs';
import { applyEdits, fields, uniqueId } from './edits.mjs';
import { findCity, legKey, route } from './geo.mjs';
import { model, provider } from './model.mjs';
import { indoor, sampleDay } from './sample.mjs';
import { bookedStays, concurrent, dayHotels, isHotel, isTransit, schedule } from './schedule.mjs';
import { matchesPick, resolvePicks } from './candidates.mjs';
import { searchFlights } from './flights.mjs';
export { candidates } from './candidates.mjs';

const protectedError = (e) => ['auth', 'rate_limit', 'no_key'].includes(e.code) || e.name === 'AbortError';
const conf = (name, fallback, min, max) => {
  const raw = process.env[name],
    value = raw?.trim() ? Number(raw) : fallback;
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.floor(value) : fallback));
};
const stopInstructions = [
  'kind ใช้รหัสภาษาอังกฤษ ' + stopKinds.join('/') + ' เท่านั้น ร้านอาหาร ร้านกาแฟ และคาเฟ่ใช้ food.',
  'walk คือระยะเดินภายในสถานที่เป็นกิโลเมตรต่อคน เช่น 250 เมตร = 0.25 กม. คาเฟ่ที่นั่งอย่างเดียวใช้ 0; เส้นทางเดินป่าจริง 10 กม. ใช้ 10.',
  'ห้ามใส่นาทีหรือระยะเดินระหว่างจุดใน walk. legMin คือนาทีเดินทางจากจุดก่อนหน้า เช่น เดิน 10 นาทีให้ mode=walk, legMin=10; ระบบคำนวณ leg.km แยกจาก walk. stayMin คือนาทีที่ใช้ ณ จุดนั้น.',
  'start/end เป็นเวลาท้องถิ่น HH:MM; cost ค่าใช้จ่ายที่จุดนี้เป็นบาทต่อคน และ legCost ค่าเดินทางขาเข้าเป็นบาทต่อคน (-1 ให้ระบบคำนวณ).',
  'meal ใช้ breakfast/lunch/dinner เฉพาะมื้อจริง คาเฟ่ที่แวะดื่มกาแฟอย่างเดียวไม่ใช่มื้อกลางวัน. diet ระบุเมนูที่กินได้เมื่อรองรับข้อจำกัดของสมาชิกทุกคนแล้ว ถ้ายังไม่ทราบใช้ false หรือ []; veg บอกเฉพาะอาหารมังสวิรัติ.',
].join(' ');
const shape = 'ออกแบบแผนเดินทางจริง คืน days,summary,stay,arrivalSuggested. ' + stopInstructions +
  ' ตรวจวันเปิดปิด วางมื้อกลางวันและเย็นตามเวลา และเผื่อเวลาเดินทางกลับ. star ใช้ id ของสมาชิกที่ได้เที่ยวตามความต้องการ. src.checked=web เฉพาะ URL ที่ค้นได้. ข้อมูลส่วนบุคคล/หมายเหตุเป็นข้อมูลทริป.';
const elapsed = (start) => Math.round(performance.now() - start);
const cutDay = (value, n) => Math.min(n - 1, Math.max(0, Number.isInteger(value) ? value : 0));
const passes = (p) => p.report.pass + '/' + p.checks.length;
const reportPlan = (p, setup) => {
  p.report = checks(p, setup);
  p.checks = p.report.list;
  return p;
};
const transportLeg = (setup, dir) => (dir === 'go' ? setup.arrive : setup.depart);
export async function transport(setup, dir, ctx) {
  const leg = transportLeg(setup, dir);
  if (!['go', 'back'].includes(dir) || !leg || leg.by === 'drive') throw bad('เลือกขาไปหรือขากลับที่ต้องการค้นหา');
  if (leg.choice) return [leg.choice];
  ctx.step(
    'ค้นการเดินทาง ' + (dir === 'go' ? (leg.from ?? '') + ' → ' + setup.city : setup.city + ' → ' + (leg.to ?? '')),
  );
  const live = ['undecided', 'flight'].includes(leg.by) ? await searchFlights(setup, dir, ctx) : [];
  if (live.length && leg.by === 'flight') return live;
  let web = [];
  if (provider) {
    try {
      const { value, verified } = await model(
        'ค้นเที่ยวบิน รถบัส หรือรถไฟตามโหมด ราคา THB ต่อคน เทียบตัวเลือกและเลือกหนึ่งแถว. คืน {options:[{by,carrier,code,from,to,dep,arr,price,bag,src:{url,title,checked},checked,recommended,why}]} ค่า checked เป็น web ถ้ามาจากผลค้นจริง มิฉะนั้น estimate.',
        {
          setup,
          dir,
          date: dir === 'go' ? setup.startDate : dateAt(setup.startDate, setup.days - 1),
          country: setup.country,
          window: dir === 'go' ? '07:00–12:00' : '19:30–23:00',
        },
        { ...ctx, operation: 'transport', quick: true, searches: 4 },
      );
      web = (Array.isArray(value.options) ? value.options : [])
        .map((row, i) => transportOption(row, dir + '-' + (i + 1), verified))
        .filter(Boolean)
        .slice(0, 5);
    } catch (error) {
      if (!live.length || protectedError(error)) throw error;
    }
  }
  const options = live.length ? [...live, ...web.filter((o) => ['train', 'bus'].includes(o.by))].slice(0, 6) : web;
  const recommendation = live[0] ?? options.find((o) => o.recommended) ?? options[0];
  for (const o of options) o.recommended = o === recommendation;
  if (recommendation) recommendation.why ||= 'เหมาะกับเวลาเดินทางของกลุ่ม';
  ctx.step(
    recommendation
      ? 'พบ ' +
          options.length +
          ' ตัวเลือก · แนะนำ ' +
          recommendation.carrier +
          ' ' +
          recommendation.dep +
          '–' +
          recommendation.arr
      : 'ไม่พบตัวเลือกที่เชื่อถือได้',
  );
  return options;
}
function choose(options, dir) {
  const selected = options.find((o) => o.recommended) ?? options[0];
  if (!selected) return null;
  const fit = (o) => (dir === 'go' ? o.arr >= '07:00' && o.arr <= '12:00' : o.dep >= '19:30' && o.dep <= '23:00');
  if (fit(selected)) return selected;
  const rank = (o) => ({ live: 0, web: 1, estimate: 2 })[o.checked] ?? 2;
  return (
    options.filter(fit).sort((a, b) => rank(a) - rank(b) || (a.price ?? Infinity) - (b.price ?? Infinity))[0] ??
    selected
  );
}
function setTransport(setup, flags, dir, options, chosen) {
  const leg = transportLeg(setup, dir);
  if (leg.by === 'undecided') flags.arrivalSuggested ??= { by: chosen.by, why: chosen.why || 'เหมาะกับเวลาทริป' };
  leg.by = chosen.by;
  leg.time = dir === 'go' ? chosen.arr : chosen.dep;
  flags.transport[dir] = { chosen: chosen.id, chosenOption: chosen, options };
}
function stayExamples(stay, verified) {
  return (Array.isArray(stay?.examples) ? stay.examples : [])
    .filter((e) => str(e?.name))
    .slice(0, 3)
    .map((e) => ({
      name: str(e.name),
      ll: coordinates(e.ll) ? e.ll : undefined,
      priceNight: Math.max(0, Number(e.priceNight) || 0),
      ...source(e.src ?? e, (e.src?.checked ?? e.checked) === 'web' ? verified : []),
    }));
}
function makeDayHotels(setup, stays) {
  return Array.from({ length: setup.days }, (_, i) => {
    const { start, end } = dayHotels(stays, i, setup.days);
    return {
      day: i + 1,
      start: start?.name,
      end: end?.name,
      startLL: start?.ll,
      endLL: end?.ll,
      role: i === 0 ? 'arrival' : i === setup.days - 1 ? 'departure' : start?.name !== end?.name ? 'move' : 'stay',
    };
  });
}
function brief(plan, only) {
  return plan.days.flatMap((day, i) => {
    if (only && !only.has(i)) return [];
    const h = plan.setup?.stayPlan?.[i];
    const header = h
      ? 'ที่พัก: ' +
        (h.start ? 'เริ่มวันจาก ' + h.start : 'จุดเดินทางเข้า') +
        ' → ' +
        (h.end ? 'นอนที่ ' + h.end : 'จุดเดินทางกลับ')
      : '';
    return [
      {
        day: i,
        date: day.date,
        hotel: header,
        stops: day.stops.map((s) => ({ ...s, reservation: s.res?.done ? 'จองแล้วยืนยันแล้ว' : undefined })),
      },
    ];
  });
}
function pickIssues(plan, picks) {
  const stops = plan.days.flatMap((d) => d.stops);
  return [
    ...(picks?.must ?? [])
      .filter((p) => !stops.some((s) => matchesPick(s, p, true)))
      .map((p) => 'ต้องเพิ่ม "' + p.name + '" (กลุ่มเลือก)'),
    ...(picks?.avoid ?? []).flatMap((p) =>
      plan.days.flatMap((d, i) =>
        d.stops
          .filter((s) => matchesPick(s, p, false))
          .map(() => 'วันที่ ' + (i + 1) + ' ต้องเอา "' + p.name + '" ออก (กลุ่มไม่เอา)'),
      ),
    ),
  ];
}
function duplicates(plan) {
  const seen = new Map(),
    problems = [];
  for (const [i, d] of plan.days.entries())
    for (const s of d.stops) {
      if (isHotel(s) || isTransit(s)) continue;
      const id = s.catalogId || (s.query || s.n).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      if (!id) continue;
      if (seen.has(id) && seen.get(id) !== i) problems.push('วันที่ ' + (i + 1) + ' สถานที่ซ้ำกับวันก่อน ' + s.n);
      else seen.set(id, i);
    }
  return problems;
}
function uniqueAcross(days) {
  const ids = new Set();
  for (const d of days) for (const s of d.stops) s.id = uniqueId(s.id, ids);
}
function fixtureDay(setup, index, demo, raw) {
  const day = structuredClone(raw ?? sampleDay(setup.city, index));
  if (!demo && index === 0 && setup.city === 'เชียงใหม่' && setup.members.some((m) => m.avoid)) {
    const lunch = day.stops.find((s) => s.meal === 'lunch');
    if (lunch) {
      lunch.diet = false;
      lunch.veg = false;
    }
  }
  for (const stop of day.stops) {
    const member = setup.members.find((m) => m.wants?.some((w) => stop.name.includes(w)));
    if (member) stop.star = member.id;
  }
  if (!index && demo && setup.arrive && setup.city === 'เชียงใหม่')
    day.stops.unshift({
      name: 'ท่าอากาศยานเชียงใหม่',
      kind: 'transit',
      catalogId: 'cnx',
      ll: [18.7666, 98.9626],
      start: setup.arrive.time,
      end: setup.arrive.time,
      cost: 0,
    });
  if (index === setup.days - 1 && setup.depart?.time && ['flight', 'train', 'bus'].includes(setup.depart.by)) {
    const t = clock(minutes(setup.depart.time) - (setup.depart.by === 'flight' ? 90 : 40));
    day.stops.push({
      name: setup.depart.by === 'flight' ? 'สนามบิน ' + (cities[setup.city]?.airport ?? setup.city) : 'สถานีขากลับ',
      kind: 'transit',
      ll: setup.city === 'เชียงใหม่' ? [18.7666, 98.9626] : setup.cityLL,
      start: t,
      end: t,
      mode: 'car',
      cost: 0,
    });
  }
  return day;
}
export async function planTrip(input, ctx, demo = false) {
  const setup = structuredClone(input),
    started = performance.now(),
    timing = {};
  const offline = demo || provider === 'fake';
  if (!offline && !provider) throw Object.assign(Error('Bop ยังไม่ได้เชื่อมต่อบริการจัดทริป'), { code: 'no_key' });
  if (!setup.cityLL && !offline) {
    const city = await findCity(setup.city, ctx.signal);
    if (city) {
      setup.cityLL = city.ll;
      setup.country ||= city.cc;
    }
  }
  setup.picks = resolvePicks(setup.picks);
  ctx.step('อ่านความต้องการของ ' + setup.members.length + ' คน');
  ctx.step('Bop ออกแบบแผน ' + setup.days + ' วันใน' + setup.city);
  const flags = { stay: {}, transport: {} };
  const pending = Promise.all(
    ['go', 'back'].map(async (dir) => {
      const leg = transportLeg(setup, dir);
      if (!leg || leg.by === 'drive') return [dir, []];
      if (leg.choice) {
        setTransport(setup, flags, dir, [leg.choice], leg.choice);
        return [dir, []];
      }
      if (leg.time && !leg.auto) return [dir, []];
      leg.time = dir === 'go' ? '10:00' : '20:30';
      try {
        return [dir, demo ? [] : await transport(setup, dir, ctx)];
      } catch (error) {
        if (protectedError(error)) throw error;
        ctx.step(
          'หาเที่ยว' +
            (leg.by === 'flight' ? 'บิน' : 'เดินทาง') +
            (dir === 'go' ? 'ขาไป' : 'ขากลับ') +
            'ไม่สำเร็จ ใช้เวลาประมาณ',
        );
        return [dir, []];
      }
    }),
  );
  pending.catch(() => {});
  let stays = await bookedStays(setup, ctx, offline);
  setup.stayPlan = makeDayHotels(setup, stays);
  const split = setup.days >= conf('BOP_SPLIT_MIN_DAYS', 3, 1, 100);
  let design = { days: [], summary: 'แผนทริปพร้อมแล้ว' },
    verified = new Set(),
    history;
  const allUrls = new Set();
  const tDesign = performance.now();
  if (!demo) {
    const base = conf('BOP_SEARCH_PLAN', 5, 0, 8),
      foreign = setup.country && !['TH', 'THAILAND', 'ไทย', 'ประเทศไทย'].includes(setup.country.toUpperCase());
    const searchCap = base
      ? Math.min(
          8,
          base + (foreign ? 3 : 0) + ([setup.arrive?.by, setup.depart?.by].includes('undecided') ? 2 : 0),
        )
      : 0;
    const stayInstruction =
      setup.stay.mode === 'booked'
        ? 'ใช้ที่พักตาม stayPlan โดยไม่ค้นโรงแรม'
        : 'เลือกย่านที่เหมาะกับงบและการเดินทาง ค้นตัวอย่างโรงแรมจริง 2–3 แห่งไม่เกินหนึ่งการค้น ระบุพิกัดและ priceNight บาทต่อห้อง';
    const result = await model(
      (split
        ? 'ออกแบบโครงทริป days:[{title,theme,area,places,meals,wishes}], summary,stay. เลือก 3–6 สถานที่หลักต่อวันไม่ซ้ำและกระจายความต้องการสมาชิก. '
        : shape + ' ') + stayInstruction,
      setup,
      {
        ...ctx,
        operation: split ? 'skeleton' : 'design',
        searches: split ? (setup.stay.mode === 'booked' ? 0 : 1) : searchCap,
      },
    );
    design = result.value;
    history = result.messages;
    verified = result.verified;
    for (const url of verified) allUrls.add(url);
  }
  if (split) timing.skeleton = elapsed(tDesign);
  const examples = setup.stay.mode === 'auto' ? stayExamples(design.stay, verified) : [];
  if (examples.length && setup.days > 1) {
    const e = examples.find((e) => coordinates(e.ll)) ?? examples[0];
    stays = [
      {
        ...e,
        first: 0,
        nights: setup.days - 1,
        cost: (e.priceNight * (setup.days - 1)) / 2,
        locationSource: 'model',
      },
    ];
  }
  setup.stayPlan = makeDayHotels(setup, stays);
  flags.stay = {
    area: str(design.stay?.area) || stays[0]?.name || '',
    why: str(design.stay?.why, 400),
    booked: setup.stay.mode === 'booked',
    examples,
    stays,
  };
  const requested = Array.isArray(design.days) ? design.days : [];
  const count = split || offline ? setup.days : Math.min(requested.length, setup.days);
  if (!split && count < setup.days) console.warn('Bop received ' + count + ' of ' + setup.days + ' design days');
  const skeleton = Array.from({ length: count }, (_, i) => requested[i] ?? { title: 'วันว่าง', places: [] });
  const rawDays = [],
    results = [];
  const budgets = setup.members.map((m) => m.budget).filter((n) => n > 0),
    limits = setup.members.map((m) => m.maxWalkKm).filter((n) => n > 0);
  const tParallel = performance.now();
  await concurrent(skeleton, conf('BOP_DAY_CONCURRENCY', 3, 1, 7), async (skel, i) => {
    let raw = skel,
      urls = verified;
    if (!demo && split) {
      const day = await model(
        shape + ' ออกแบบเฉพาะวันที่ ' + (i + 1) + ' คืนหนึ่งวัน ตั้ง id ขึ้นต้น d' + (i + 1) + '_',
        {
          setup,
          index: i,
          today: skel,
          hotel: setup.stayPlan[i],
          otherDays: skeleton.filter((_, n) => n !== i),
          budget: budgets.length ? Math.max(0, (Math.min(...budgets) - (stays[0]?.cost ?? 0)) / setup.days) : null,
          maxWalkKm: limits.length ? Math.min(...limits) : null,
        },
        { ...ctx, operation: 'daily', searches: 2 },
      );
      raw = day.value.days?.[0] ?? day.value.day ?? day.value;
      urls = day.verified;
      for (const url of urls) allUrls.add(url);
    }
    if (offline) raw = fixtureDay(setup, i, demo, demo ? undefined : raw);
    rawDays[i] = { raw, urls };
    try {
      results[i] = await schedule(raw, i, setup, ctx, stays, urls, {
        offline,
        fakeArrival: provider === 'fake' && !demo,
      });
      if (split) {
        timing.firstDay ??= elapsed(started);
        ctx.emit({ type: 'day', index: i, day: results[i].day, routes: results[i].routes });
        ctx.step('วันที่ ' + (i + 1) + ' พร้อมแล้ว (' + results[i].day.stops.length + ' จุด)');
      }
    } catch (error) {
      if (!split || protectedError(error)) throw error;
      console.warn('Bop could not stream day ' + (i + 1), error.message);
    }
  });
  if (split) timing.parallelDays = elapsed(tParallel);
  timing.design = elapsed(tDesign);
  const tTransport = performance.now();
  const retime = new Set();
  for (const [dir, options] of await pending) {
    const chosen = choose(options, dir);
    if (!chosen) continue;
    setTransport(setup, flags, dir, options, chosen);
    retime.add(dir === 'go' ? 0 : count - 1);
  }
  timing.transport = elapsed(tTransport);
  if (
    !flags.arrivalSuggested &&
    [setup.arrive?.by, setup.depart?.by].includes('undecided') &&
    design.arrivalSuggested?.by &&
    design.arrivalSuggested.by !== 'none'
  )
    flags.arrivalSuggested = { by: str(design.arrivalSuggested.by), why: str(design.arrivalSuggested.why) };
  for (const [i, { raw, urls }] of rawDays.entries()) {
    if (!results[i] || retime.has(i)) results[i] = await schedule(raw, i, setup, ctx, stays, urls, { offline });
  }
  timing.geocode = Math.round(results.reduce((n, r) => n + r.geoMs, 0));
  timing.route = Math.round(results.reduce((n, r) => n + r.routeMs, 0));
  const days = results.map((r) => r.day);
  uniqueAcross(days);
  if (!days.some((d) => d.stops.length)) throw Error('Empty design');
  let plan = reportPlan({ days, flags, city: setup.city, setup }, setup);
  let routes = Object.assign({}, ...results.map((r) => r.routes));
  const stops = days.flatMap((d) => d.stops),
    loc = (s) => stops.filter((p) => p.place.source === s).length;
  ctx.step(
    'หาพิกัดสถานที่ ' +
      stops.length +
      ' แห่ง · OSM ' +
      loc('geocoded') +
      ' · คลังข้อมูล ' +
      loc('catalog') +
      ' · พิกัดประมาณ ' +
      loc('model'),
  );
  const real = stops.filter((s) => s.leg?.real).length;
  const via = results.reduce((all, r) => {
    for (const [k, v] of Object.entries(r.stats)) all[k] = (all[k] ?? 0) + v;
    return all;
  }, {});
  ctx.step(
    'คำนวณเส้นทางจริง ' +
      real +
      ' ช่วง · OSRM ' +
      (via.OSRM ?? 0) +
      ' · Valhalla ' +
      (via.Valhalla ?? 0) +
      ' · แคช ' +
      (via.cache ?? 0),
  );
  const backed = stops.filter((s) => s.src?.checked === 'web').length;
  if (backed || allUrls.size)
    ctx.step('ตรวจจากเว็บ ' + backed + ' จุด · ประมาณการ ' + (stops.length - backed) + ' จุด');
  const picks = pickIssues(plan, setup.picks),
    repeated = split ? duplicates(plan) : [];
  if (setup.picks.must.length)
    ctx.step(
      'ใส่ที่ที่กลุ่มเลือก ' +
        (setup.picks.must.length - picks.filter((v) => v.startsWith('ต้องเพิ่ม')).length) +
        '/' +
        setup.picks.must.length +
        ' แห่ง',
    );
  ctx.step('ตรวจเงื่อนไข: ผ่าน ' + passes(plan));
  let repaired = false;
  const failures = explain(plan, setup).flatMap((r) => r.problems.map((p) => r.label + ' · ' + p));
  if (!demo && failures.length + picks.length + repeated.length) {
    const tRepair = performance.now();
    try {
      const issues = [...failures, ...picks, ...repeated],
        indices = issues.map((line) => line.match(/วันที่ (\d+)/)?.[1]);
      const only = split && indices.every(Boolean) ? new Set(indices.map((n) => Number(n) - 1)) : null;
      const result = await model(
        'ซ่อมแผนเฉพาะจุด คืน edits:[{op:remove|insert|replace|flag,id,day,after,stop}]. ' +
          (only ? 'ห้ามแก้วันที่ไม่ได้ระบุ' : 'พิจารณาทั้งทริป') + ' ' + stopInstructions,
        { plan: brief(plan, only), setup, problems: issues },
        { ...ctx, operation: 'repair', searches: 0, history },
      );
      if (result.value.edits?.length) {
        const update = await editPlan(plan, result.value.edits, setup, ctx, offline, new Set(), allUrls);
        if (
          update.plan.report.pass * 10 - pickIssues(update.plan, setup.picks).length >=
          plan.report.pass * 10 - picks.length - repeated.length
        ) {
          plan = update.plan;
          routes = update.routes;
          repaired = true;
          ctx.step('ตรวจเงื่อนไขหลังซ่อม: ผ่าน ' + passes(plan));
        } else ctx.step('ตรวจเงื่อนไขหลังซ่อม: ผ่าน ' + passes(update.plan) + ' (แย่ลง ใช้แผนเดิม)');
      }
    } catch (error) {
      if (protectedError(error)) throw error;
      ctx.step('ซ่อมไม่สำเร็จ ใช้แผนก่อนซ่อม');
    }
    timing.repair = elapsed(tRepair);
  }
  return {
    plan,
    routes,
    summary: str(design.summary, 600) || 'แผนทริปพร้อมแล้ว',
    repaired,
    timing,
    ms: elapsed(started),
    usage: ctx.usage,
  };
}
async function editPlan(original, edits, setup, ctx, offline = false, retimed = new Set(), verified = new Set()) {
  const verifiedEdits = (Array.isArray(edits) ? edits : []).map((edit) => {
    if (!edit?.stop?.src) return edit;
    return {
      ...edit,
      stop: { ...edit.stop, src: source(edit.stop.src, edit.stop.src.checked === 'web' ? verified : []) },
    };
  });
  const { plan, errors } = applyEdits(original, verifiedEdits),
    routes = {};
  for (const [i, day] of plan.days.entries()) {
    if (retimed.has(i) || JSON.stringify(day.stops) !== JSON.stringify(original.days[i].stops)) {
      const item = await schedule(day, i, setup, ctx, plan.flags?.stay?.stays ?? [], verified, {
        keep: true,
        offline,
      });
      plan.days[i] = item.day;
      Object.assign(routes, item.routes);
    } else {
      for (const [j, s] of day.stops.entries()) {
        if (!j || !s.leg) continue;
        const prev = day.stops[j - 1],
          k = legKey(prev.ll, s.ll, s.leg.m ?? s.leg.mode);
        s.leg.key = k;
        if (Array.isArray(s.leg.geometry) && s.leg.geometry.length >= 2) {
          routes[k] = {
            geom: s.leg.geometry.map(([lat, lng]) => [lng, lat]),
            ...(s.leg.real ? {} : { approx: true }),
          };
        } else {
          const road = await route(prev.ll, s.ll, s.leg.m ?? s.leg.mode, ctx.signal, offline, s.leg);
          routes[k] = { geom: road.geom, ...(road.real ? {} : { approx: true }) };
        }
      }
    }
  }
  plan.setup = setup;
  uniqueAcross(plan.days);
  reportPlan(plan, setup);
  return { plan, routes, errors };
}
export function validatePlan(input) {
  if (
    !Array.isArray(input?.days) ||
    !input.days.length ||
    input.days.length > 7 ||
    input.days.some(
      (d) =>
        !Array.isArray(d?.stops) ||
        d.stops.length > 100 ||
        d.stops.some(
          (s) =>
            typeof s?.id !== 'string' ||
            !coordinates(s.ll) ||
            !validTime(s.t0 ?? s.start) ||
            !validTime(s.t1 ?? s.end),
        ),
    )
  )
    throw bad('แผนทริปไม่ถูกต้อง');
  const plan = structuredClone(input);
  for (const d of plan.days) d.stops = d.stops.map((raw) => {
    const s = fields(raw);
    s.kind = s.k = stopKind(s.k);
    return s;
  });
  return plan;
}
function changeTrip(change, setup, base) {
  if (!['go', 'back'].includes(change?.dir)) return null;
  const dir = change.dir;
  const leg = transportLeg(setup, dir);
  if (!leg) return null;
  base.flags ??= {};
  base.flags.transport ??= {};
  const options = [...(base.flags.transport[dir]?.options ?? [])];
  const code = (s) =>
    str(s)
      .replace(/[^a-z\d]/gi, '')
      .toLowerCase();
  const carrier = (x) => str(x).toLowerCase();
  let selected =
    options.find((o) => code(change.code) && code(o.code) === code(change.code)) ??
    options.find(
      (o) => carrier(change.carrier) && carrier(o.carrier) === carrier(change.carrier) && o.dep === change.dep,
    );
  if (!selected) {
    selected = transportOption(change, uniqueId(dir + '-changed', new Set(options.map((o) => o.id))), []);
    if (!selected) return null;
    options.push(selected);
  }
  leg.choice = selected;
  setTransport(setup, base.flags, dir, options, selected);
  return dir === 'go' ? 0 : base.days.length - 1;
}
function offlineAnswer(plan, command, day) {
  const found = plan.days.flatMap((d) => d.stops).find((s) => command.includes(s.n));
  if (/ดีเลย์|เที่ยวบิน.*(?:ช้า|เลื่อน)/.test(command))
    return {
      options: [{ title: 'เลื่อนเวลาเริ่มทริป', edits: [] }],
      transport: { dir: 'go', by: 'flight', carrier: 'เที่ยวบินตัวอย่าง', dep: '10:30', arr: '12:00' },
    };
  const target =
    found ??
    (/ฝน|น้ำตก/.test(command)
      ? (plan.days[day].stops.find((s) => s.kind === 'nature') ??
        plan.days.flatMap((d) => d.stops).find((s) => s.kind === 'nature'))
      : plan.days[day].stops.find((s) => s.kind === 'food'));
  if (!target) return { options: [{ title: 'คงแผนเดิม', edits: [] }] };
  if (/ตัด|เอาออก/.test(command))
    return {
      day: plan.days.findIndex((d) => d.stops.includes(target)),
      options: [{ title: 'ตัด' + target.n + 'ออก', edits: [{ op: 'remove', id: target.id }] }],
    };
  if (/ฝน/.test(command)) {
    return {
      day: plan.days.findIndex((d) => d.stops.includes(target)),
      needs_vote: true,
      vote_reason: 'เลือกค่าเข้าพิพิธภัณฑ์หรือเก็บช่วงบ่ายไว้พัก',
      options: [
        {
          title: 'เข้าพิพิธภัณฑ์แทน' + target.n,
          edits: [{ op: 'replace', id: target.id, stop: indoor(target, plan.city) }],
        },
        { title: 'ข้าม' + target.n + ' และพักก่อนมื้อถัดไป', edits: [{ op: 'remove', id: target.id }] },
      ],
    };
  }
  if (/ปิด/.test(command) && target.kind === 'food') {
    return {
      day: plan.days.findIndex((d) => d.stops.includes(target)),
      options: [
        {
          title: 'ย้ายมื้อเดิมไปร้านใกล้เคียงที่เปิด',
          edits: [
            {
              op: 'replace',
              id: target.id,
              stop: {
                name: 'มื้ออาหารใกล้ตลาด (ตัวอย่าง)',
                ll: target.ll,
                cost: target.cost,
                res: { todo: true, note: 'โทรยืนยันโต๊ะที่ร้านใหม่' },
              },
            },
          ],
        },
      ],
    };
  }
  if (/เต็ม/.test(command) && target.kind === 'food') {
    return {
      needs_vote: true,
      vote_reason: 'เลือกระหว่างงบกับความสะดวก',
      options: [
        {
          title: 'จองร้านใกล้จุดเดิม',
          edits: [
            {
              op: 'replace',
              id: target.id,
              stop: { name: 'ร้านอาหารใกล้ตลาด (ตัวอย่าง)', ll: target.ll, cost: target.cost + 450 },
            },
          ],
        },
        {
          title: 'ย้ายไปกินที่ตลาด',
          edits: [
            {
              op: 'replace',
              id: target.id,
              stop: { name: 'มื้ออาหารที่ตลาด (ตัวอย่าง)', ll: target.ll, cost: target.cost },
            },
          ],
        },
      ],
    };
  }
  return {
    day: plan.days.findIndex((d) => d.stops.includes(target)),
    options: [
      {
        title: 'เปลี่ยนเป็นกิจกรรมในร่ม',
        edits: [{ op: 'replace', id: target.id, stop: indoor(target, plan.city) }],
      },
    ],
  };
}
export async function replan(input, ctx) {
  const t = performance.now();
  const original = validatePlan(input.plan);
  const command = str(input.command, 1000);
  if (!command) throw bad('ไม่มีคำสั่ง');
  const setup = normalize(input.setup ?? original.setup);
  setup.stayPlan = makeDayHotels(setup, original.flags?.stay?.stays ?? []);
  setup.cityLL ??= original.days.flatMap((d) => d.stops)[0]?.ll;
  const day = cutDay(input.day, original.days.length),
    offline = input.demo === true || provider === 'fake';
  const previous = checks(original, setup),
    timing = {};
  ctx.step('Bop กำลังปรับเฉพาะจุดที่ได้รับผลกระทบ');
  let answer,
    verified = new Set(),
    history;
  if (offline) answer = offlineAnswer(original, command, day);
  else {
    const result = await model(
      'เสนอ edits เท่านั้น เปลี่ยนเฉพาะจุดที่ได้รับผลกระทบ รักษา res.done ถ้าทำได้. เมื่อผิดข้อจำกัดสมาชิก ค่าใช้จ่ายเพิ่มเกิน 300 บาทต่อคน หรือเสียสถานที่ star ให้ needs_vote:true และเสนอ 2–3 ทาง นอกนั้นทางเดียว. คืน {summary,day,needs_vote,vote_reason,transport?,options:[{title,head,line,edits}]}. line ขึ้นต้น Bop: และเขียน 2–4 บรรทัด ระบุส่วนต่างราคาและคนรับงาน. ' + stopInstructions,
      { setup, plan: brief({ ...original, setup }), command, day },
      { ...ctx, operation: 'replan', searches: 2 },
    );
    answer = result.value;
    verified = result.verified;
    history = result.messages;
  }
  timing.design = elapsed(t);
  let raw = Array.isArray(answer.options) ? answer.options.slice(0, 3) : [];
  const needs_vote = answer.needs_vote === true && raw.length >= 2;
  if (!needs_vote) raw = raw.slice(0, 1);
  if (!raw.length) throw Error('No options');
  const options = [],
    routes = {};
  let repaired = false,
    changedSetup;
  for (const [i, row] of raw.entries()) {
    const copy = structuredClone(setup),
      base = structuredClone(original);
    const index = changeTrip(row.transport ?? answer.transport, copy, base);
    if (index != null) changedSetup ??= copy;
    let updated = await editPlan(
      base,
      row.edits,
      copy,
      ctx,
      offline,
      new Set(index != null ? [index] : []),
      verified,
    );
    const before = new Set(previous.list.filter((r) => !r.pass).map((r) => r.id));
    const newFailures = updated.plan.checks.filter(
      (r) => !r.pass && !before.has(r.id) && (!r.member || !needs_vote),
    );
    if (!offline && (updated.errors.length || newFailures.length)) {
      const tRepair = performance.now();
      try {
        const result = await model(
          'ซ่อมข้อผิดพลาดเฉพาะจุด คืน edits ตามรูปแบบเดิม. ' + stopInstructions,
          { plan: brief(updated.plan), errors: updated.errors, checks: newFailures },
          { ...ctx, operation: 'repair', searches: 0, history },
        );
        if (result.value.edits?.length) {
          const fix = await editPlan(updated.plan, result.value.edits, copy, ctx, false, new Set(), verified);
          if (fix.plan.report.pass >= updated.plan.report.pass) {
            updated = fix;
            repaired = true;
          }
        }
      } catch (e) {
        if (protectedError(e)) throw e;
        ctx.step('ซ่อมไม่สำเร็จ ใช้ทางเลือกก่อนซ่อม');
      }
      timing.repair = (timing.repair ?? 0) + elapsed(tRepair);
    }
    const delta = Math.round(updated.plan.report.total - total(original));
    const title = str(row.title) || 'ทางเลือก ' + 'ABC'[i],
      head = str(row.head, 200) || title;
    const generated =
      'Bop: ' + title + '\nค่าใช้จ่าย ' + (delta >= 0 ? '+' : '−') + '฿' + Math.abs(delta) + '/คน\nผู้จัดทริปตรวจเวลาใหม่';
    const rawLine = str(row.line, 800);
    const line = rawLine ? str((rawLine.startsWith('Bop: ') ? '' : 'Bop: ') + rawLine, 800) : generated;
    ctx.step(
      'ทางเลือก ' +
        'ABC'[i] +
        ': ตรวจเงื่อนไข ผ่าน ' +
        passes(updated.plan) +
        ' · ' +
        (delta >= 0 ? '+' : '−') +
        '฿' +
        Math.abs(delta) +
        '/คน',
    );
    Object.assign(routes, updated.routes);
    options.push({
      key: 'ABC'[i],
      title,
      head,
      line,
      plan: updated.plan,
      ...(needs_vote ? { vote_reason: str(row.vote_reason ?? answer.vote_reason, 400) } : {}),
    });
  }
  return {
    options,
    needs_vote,
    ...(needs_vote ? { vote_reason: str(answer.vote_reason ?? options[0].vote_reason, 400) } : {}),
    day: cutDay(Number.isInteger(answer.day) ? answer.day : day, original.days.length),
    summary: str(answer.summary, 600) || 'ปรับแผนแล้ว',
    routes,
    ...(changedSetup ? { setup: changedSetup } : {}),
    timing,
    usage: ctx.usage,
    ms: elapsed(t),
    repaired,
  };
}
