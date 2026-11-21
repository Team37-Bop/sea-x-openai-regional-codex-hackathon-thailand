import { applyEdits, bad, checks, cities, clock, coordinates, dateAt, minutes, normalize, source, total, transportOption, validTime } from './domain.mjs';
import { findCity, findPlace, route } from './geo.mjs';
import { wikipediaPhoto } from './photos.mjs';
import { model, provider } from './model.mjs';
import { indoor, sampleDay } from './sample.mjs';

const shape = 'คืน {days:[{title,stops:[{id,name,kind,query,ll:[lat,lon],start,end,cost,mode,diet,src:{url,title}}]}],summary,stay:{area,why,examples:[{name,ll,priceNight,src}]}} เวลา HH:MM, ค่าใช้จ่ายบาทต่อคน, diet ระบุข้อความข้อจำกัดของสมาชิกที่รองรับตามจริง, mode เป็น walk/red/van/own/car';
const protectedError = error => ['auth', 'rate_limit', 'no_key'].includes(error.code);
const budget = (value, fallback, max) => Math.min(max, Math.max(1, Number(value) || fallback));
const cleanName = value => typeof value === 'string' ? value.trim().slice(0, 130) : '';
const score = rows => rows.reduce((sum, item) => sum + (item.pass ? 10 : -item.problems.length), 0);
const isMode = value => ['walk', 'red', 'van', 'own', 'car'].includes(value);
const remembered = new Map();

function stayStops(setup, index, stays) {
  const hotelAt = night => stays.find(stay => stay.first <= night && night < stay.first + stay.nights);
  const start = index > 0 ? hotelAt(index - 1) : null;
  const end = index < setup.days - 1 ? hotelAt(index) : null;
  return [start, end].map((hotel, i) => hotel && {
    id: 'd' + (index + 1) + (i ? '_stay_end' : '_stay_start'), name: hotel.name, ll: hotel.ll,
    kind: 'hotel', mode: 'car', start: i ? '18:30' : '09:00', end: i ? '19:00' : '09:15',
    cost: hotel.first === index && i ? hotel.cost ?? 0 : 0, pinned: true,
  });
}

async function schedule(raw, index, setup, ctx, stays, verified, { keep = false, offline = false } = {}) {
  const date = dateAt(setup.startDate, index);
  const rows = Array.isArray(raw?.stops) ? raw.stops.slice(0, 18) : [];
  const [morning, evening] = keep ? [null, null] : stayStops(setup, index, stays);
  const candidates = [...(morning ? [morning] : []), ...rows, ...(evening ? [evening] : [])];
  const day = { date, title: cleanName(raw?.title) || 'วันที่ ' + (index + 1), stops: [] };
  const routes = {};
  const ids = new Set();
  for (const [i, row] of candidates.entries()) {
    const name = cleanName(row?.name);
    if (!name) continue;
    const picked = setup.picks.must?.find(pick => pick.name === name && coordinates(pick.ll));
    const hint = coordinates(row.ll) ? row.ll : null;
    const previous = day.stops.at(-1);
    const ll = picked?.ll || (row.pinned || (keep && hint) || offline ? hint : await findPlace(
      (cleanName(row.query) || name) + ' ' + setup.city, hint ?? setup.cityLL, hint ? 3 : 40, ctx.signal,
    ));
    const idPrefix = 'd' + (index + 1) + '_';
    let id = typeof row.id === 'string' && row.id.startsWith(idPrefix) ? row.id.slice(0, 70) : idPrefix + (i + 1);
    if (ids.has(id)) id = idPrefix + 'stop_' + i;
    ids.add(id);
    const point = ll || hint || previous?.ll || setup.cityLL;
    const mode = isMode(row.mode) ? row.mode : isMode(row.leg?.mode) ? row.leg.mode : 'car';
    const stop = {
      id, name, ll: point, kind: cleanName(row.kind) || 'sight', outdoor: row.outdoor === true,
      place: { source: picked || row.pinned ? 'pick' : keep ? row.place?.source ?? 'model' : ll && !offline ? 'geocoded' : 'model' },
      cost: Math.min(100_000, Math.max(0, Number(row.cost) || 0)), diet: Array.isArray(row.diet) ? row.diet.slice(0, 20) : [],
      hours: row.hours, closedDays: Array.isArray(row.closedDays) ? row.closedDays : [],
      closures: Array.isArray(row.closures) ? row.closures : [], src: keep ? row.src : source(row.src, verified), res: row.res,
    };
    const planned = validTime(row.start) ? minutes(row.start) : 600 + i * 90;
    const stay = validTime(row.end) ? Math.max(0, minutes(row.end) - planned) : 60;
    let start = planned;
    if (!index && !i && setup.arrive.time) start = minutes(setup.arrive.time);
    const isDeparture = index === setup.days - 1 && i === candidates.length - 1 && setup.depart.time
      && ['flight', 'train', 'bus'].includes(setup.depart.by) && !keep;
    if (isDeparture && row.kind === 'terminal') start = minutes(setup.depart.time) - (setup.depart.by === 'flight' ? 90 : 40);
    if (previous) {
      const road = await route(previous.ll, point, mode, ctx.signal, offline);
      const key = previous.id + ':' + id;
      routes[key] = road.geometry;
      const travellers = Math.min(5, setup.members.length);
      const cost = mode === 'walk' ? 0 : mode === 'own' ? (4 * road.km) / travellers
        : mode === 'red' ? Math.max(20, Math.ceil(road.km * 4)) : Math.ceil((35 + road.km * 9) / travellers);
      stop.leg = { key, mode, cost, km: road.km, min: road.min, real: road.real, geometry: road.geometry, src: source(null, verified) };
      start = Math.max(start, minutes(previous.end) + road.min);
    }
    stop.start = clock(start);
    stop.end = clock(start + stay);
    day.stops.push(stop);
  }
  return { day, routes };
}

export async function transport(setup, dir, ctx) {
  const leg = dir === 'go' ? setup.arrive : setup.depart;
  if (!['go', 'back'].includes(dir) || leg.by === 'drive') throw bad('เลือกขาไปหรือขากลับที่ต้องการค้นหา');
  if (leg.choice) return [leg.choice];
  ctx.step('ค้นการเดินทาง ' + (dir === 'go' ? leg.from + ' → ' + setup.city : setup.city + ' → ' + leg.to));
  if (provider === 'fake') return [];
  const { value, verified } = await model('ค้นรถไฟ รถบัส หรือเที่ยวบินตามโหมด เปรียบเทียบถ้ายังไม่เลือก คืน {options:[{by,carrier,code,from,to,dep,arr,price,bag,src:{url,title},recommended,why}]} เวลา HH:MM ราคาโดยประมาณ THB', { setup, dir },
    { ...ctx, quick: true, searches: 4 });
  const options = (Array.isArray(value.options) ? value.options : []).slice(0, 5)
    .map((row, i) => transportOption(row, dir + '-' + (i + 1), verified)).filter(Boolean);
  const morning = dir === 'go' && options.filter(option => option.checked === 'web' && option.arr >= '07:00' && option.arr <= '12:00')
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0];
  const recommendation = morning || options.find(option => option.recommended) || options[0];
  for (const option of options) option.recommended = option === recommendation;
  if (recommendation) recommendation.why ||= 'ราคาเป็นค่าประมาณจากเว็บ';
  ctx.step(recommendation ? 'พบ ' + options.length + ' ตัวเลือก · แนะนำ ' + recommendation.carrier : 'ไม่พบตัวเลือกที่เชื่อถือได้');
  return options;
}

export async function candidates(setup, ctx) {
  const cityLL = setup.cityLL ?? (await findCity(setup.city, ctx.signal))?.ll;
  const { value, verified } = provider === 'fake'
    ? { value: { questions: [{ kind: 'sight', title: 'กลุ่มอยากไปที่ไหน', options: sampleDay(setup.city, 0).stops }] }, verified: new Set() }
    : await model('คืน {questions:[{kind: food|sight|stay,title,options:[{name,why,query,tags,price,ll,src:{url,title}}]}]} ระบุร้านที่เหมาะกับข้อจำกัดอาหารแต่ละคน', setup,
      { ...ctx, quick: true, searches: 5 });
  const run = crypto.randomUUID().slice(0, 8);
  const questions = await Promise.all((Array.isArray(value.questions) ? value.questions : []).slice(0, 3).map(async (question, i) => ({
    id: 'q' + i, kind: question.kind, title: cleanName(question.title), multi: true,
    options: await Promise.all((Array.isArray(question.options) ? question.options : []).slice(0, 6).map(async (item, j) => {
      const id = 'c' + run + '_' + i + '_' + j;
      const name = cleanName(item.name);
      const ll = cityLL && provider !== 'fake'
        ? await findPlace((cleanName(item.query) || name) + ' ' + setup.city, coordinates(item.ll) ? item.ll : cityLL, coordinates(item.ll) ? 3 : 40, ctx.signal)
        : null;
      const src = source(item.src, verified);
      const point = ll || (coordinates(item.ll) ? item.ll : undefined);
      const photo = provider === 'fake' ? null : await wikipediaPhoto(name, point, setup.country === 'TH' ? 'th' : 'en', ctx.signal);
      const option = { id, name, why: cleanName(item.why), tags: Array.isArray(item.tags) ? item.tags.slice(0, 4) : [],
        price: typeof item.price === 'number' ? item.price : undefined, ll: point, photo: photo ?? undefined,
        src: src.checked === 'web' ? src : undefined };
      if (remembered.size >= 400) remembered.delete(remembered.keys().next().value);
      remembered.set(id, option);
      return option;
    })),
  })));
  ctx.step('ได้ ' + questions.length + ' คำถาม · ' + questions.reduce((sum, question) => sum + question.options.length, 0) + ' ตัวเลือก');
  return { questions };
}
async function bookedStays(setup, ctx, offline) {
  if (setup.stay.mode !== 'booked') return [];
  let first = 0;
  const rows = setup.stay.stays.map(stay => {
    const row = { ...stay, first, checkIn: dateAt(setup.startDate, first), checkOut: dateAt(setup.startDate, first + stay.nights) };
    first += stay.nights;
    return row;
  });
  return Promise.all(rows.map(async stay => {
    let ll;
    if (!offline) {
      for (const name of new Set([stay.name, stay.name.split(' ').slice(0, 3).join(' '), stay.name.split(' ').slice(0, 2).join(' ')])) {
        ll = await findPlace(name + ' ' + setup.city, setup.cityLL, 40, ctx.signal)
          ?? await findPlace(name, setup.cityLL, 200, ctx.signal);
        if (ll) break;
      }
    }
    ctx.step('ที่พักที่จองไว้: ' + stay.name + ' · ' + (ll ? 'พบบนแผนที่' : 'ใช้พิกัดประมาณ'));
    return { ...stay, ll: ll ?? setup.cityLL };
  }));
}
function stayExamples(stay, verified) {
  return (Array.isArray(stay?.examples) ? stay.examples : []).slice(0, 3)
    .filter(example => cleanName(example.name)).map(example => ({
      name: cleanName(example.name), ll: coordinates(example.ll) ? example.ll : undefined,
      priceNight: Math.max(0, Number(example.priceNight) || 0), ...source(example.src, verified),
    }));
}
export async function planTrip(setup, ctx, demo = false) {
  const started = performance.now();
  const offline = demo || provider === 'fake';
  if (!offline && !provider) throw Object.assign(new Error('Bop ยังไม่ได้เชื่อมต่อบริการจัดทริป'), { code: 'no_key' });
  if (offline && !setup.cityLL) setup.cityLL = [18.7883, 98.9853];
  setup.cityLL ??= (await findCity(setup.city, ctx.signal))?.ll;
  if (!setup.cityLL) throw bad('Bop ไม่พบพิกัดเมืองนี้');
  setup.picks = {
    must: (Array.isArray(setup.picks.must) ? setup.picks.must : []).slice(0, 18).map(pick => remembered.get(pick?.id) ?? pick).filter(pick => pick?.name),
    avoid: (Array.isArray(setup.picks.avoid) ? setup.picks.avoid : []).map(id => remembered.get(id)?.name).filter(Boolean),
  };
  ctx.step('อ่านความต้องการของ ' + setup.members.length + ' คน');
  ctx.step('Bop ออกแบบแผน ' + setup.days + ' วันใน' + setup.city);
  const pending = ['go', 'back'].map(async dir => {
    const leg = dir === 'go' ? setup.arrive : setup.depart;
    if (leg.by === 'drive' || (leg.time && !leg.auto && !leg.choice)) return [dir, []];
    try { return [dir, offline ? [] : await transport(setup, dir, ctx)]; }
    catch (error) {
      if (protectedError(error)) throw error;
      ctx.step('ค้นการเดินทางไม่สำเร็จ ใช้เวลาประมาณ');
      return [dir, []];
    }
  });
  const transportResults = Promise.all(pending);
  transportResults.catch(() => {});
  let stays = await bookedStays(setup, ctx, offline);
  const split = setup.days >= budget(process.env.BOP_SPLIT_MIN_DAYS, 3, 7);
  const ask = (instruction, data, searches) => model(instruction, data, { ...ctx, searches });
  let design = { stay: {}, summary: 'แผนทริป' }, verified = new Set();
  if (!offline) {
    const request = { ...setup, arrive: { ...setup.arrive, time: setup.arrive.time || '10:00' }, depart: { ...setup.depart, time: setup.depart.time || '20:30' } };
    const result = split
      ? await ask('ออกแบบโครงทริป คืน {days:[{title,area,places}],summary,stay:{area,why,examples:[{name,ll,priceNight,src}]}} กระจายความต้องการและงบรายวัน กำหนดมื้ออาหาร กิจกรรม 3–6 แห่งต่อวัน ไม่ซ้ำ จัดเวลาให้ทันเดินทางกลับ', request, setup.stay.mode === 'auto' ? 1 : 0)
      : await ask(shape, request, Math.min(8, 5 + (setup.country !== 'TH' ? 3 : 0) + ([setup.arrive.by, setup.depart.by].includes('undecided') ? 2 : 0)));
    design = result.value;
    verified = result.verified;
  }
  const examples = setup.stay.mode === 'auto' ? stayExamples(design.stay, verified) : [];
  if (examples.length && setup.days > 1) {
    const option = examples[0];
    stays = [{ name: option.name, ll: option.ll ?? setup.cityLL, first: 0, nights: setup.days - 1, cost: option.priceNight * (setup.days - 1) / 2 }];
  }
  const flags = { stay: { area: design.stay?.area ?? '', why: design.stay?.why ?? '', booked: setup.stay.mode === 'booked', stays, examples }, transport: {} };
  for (const [dir, options] of await transportResults) {
    const leg = dir === 'go' ? setup.arrive : setup.depart;
    const chosen = leg.choice || options.find(option => option.recommended);
    if (chosen) {
      leg.time = dir === 'go' ? chosen.arr : chosen.dep;
      if (leg.by === 'undecided') {
        if (dir === 'go') flags.arrivalSuggested = { by: chosen.by, why: chosen.why };
        leg.by = chosen.by;
      }
      flags.transport[dir] = { chosen, options: options.length ? options : [chosen] };
    }
  }
  const rows = Array.from({ length: setup.days }, (_, index) => ({ index, raw: design.days?.[index] }));
  const rendered = [];
  const routes = {};
  const width = budget(process.env.BOP_DAY_CONCURRENCY, 3, 7);
  for (let offset = 0; offset < rows.length; offset += width) {
    await Promise.all(rows.slice(offset, offset + width).map(async ({ index, raw }) => {
      let sources = verified;
      if (offline) raw = sampleDay(setup.city, index);
      else if (split) {
        const result = await ask(shape + ' ออกแบบเฉพาะวันนี้ ตั้ง id ขึ้นต้น d' + (index + 1) + '_', {
          setup, today: raw ?? { title: 'วันว่าง' }, otherDays: rows.filter(row => row.index !== index).map(row => row.raw), stays, index,
        }, 2);
        raw = result.value.days?.[0];
        sources = result.verified;
      }
      if (index === setup.days - 1 && setup.depart.time && ['flight', 'train', 'bus'].includes(setup.depart.by)) {
        const cutoff = clock(minutes(setup.depart.time) - (setup.depart.by === 'flight' ? 90 : 40));
        const cityInfo = cities[setup.city];
        raw = { ...raw, stops: [...(Array.isArray(raw?.stops) ? raw.stops : []), {
          name: setup.depart.by === 'flight' ? 'สนามบิน' + (cityInfo?.airport ? ' ' + cityInfo.airport : '') : 'สถานีขากลับ',
          start: cutoff, end: cutoff, kind: 'terminal', mode: 'car',
        }] };
      }
      const item = await schedule(raw, index, setup, ctx, stays, sources, { offline });
      rendered[index] = item.day;
      Object.assign(routes, item.routes);
      if (split) ctx.emit({ type: 'day', index, day: item.day, routes: item.routes });
      ctx.step('วันที่ ' + (index + 1) + ' พร้อมแล้ว (' + item.day.stops.length + ' จุด)');
    }));
  }
  if (!rendered.some(day => day.stops.length)) throw new Error('Empty plan');
  const plan = { days: rendered, flags, city: setup.city, setup };
  plan.checks = checks(plan, setup);
  const pickProblems = setup.picks.must.filter(pick => !rendered.some(day => day.stops.some(stop => stop.name === pick.name)))
    .map(pick => 'ต้องเพิ่ม ' + pick.name);
  const seen = new Set();
  for (const day of rendered) for (const stop of day.stops) {
    if (setup.picks.avoid.includes(stop.name)) pickProblems.push('ต้องเอา ' + stop.name + ' ออก (กลุ่มไม่เอา)');
    if (stop.kind !== 'hotel' && seen.has(stop.name)) pickProblems.push('สถานที่ซ้ำ ' + stop.name);
    seen.add(stop.name);
  }
  const passed = report => report.filter(row => row.pass).length + '/' + report.length;
  ctx.step('ตรวจเงื่อนไข: ผ่าน ' + passed(plan.checks));
  let repaired = false;
  if (!offline && (plan.checks.some(row => !row.pass) || pickProblems.length)) {
    try {
      const result = await ask('ซ่อมแผนเฉพาะจุด คืน {edits:[{op:remove|insert|replace,id,stop}]}', { plan, problems: pickProblems }, 0);
      const update = await editPlan(plan, result.value.edits, setup, ctx);
      if (!update.errors.length && score(update.plan.checks) >= score(plan.checks)) {
        Object.assign(plan, update.plan);
        Object.assign(routes, update.routes);
        repaired = true;
        ctx.step('ตรวจเงื่อนไขหลังซ่อม: ผ่าน ' + passed(plan.checks));
      }
    } catch (error) {
      if (protectedError(error)) throw error;
      ctx.step('ซ่อมไม่สำเร็จ ใช้แผนก่อนซ่อม');
    }
  }
  return { plan, routes, summary: cleanName(design.summary) || 'แผนทริปพร้อมแล้ว', repaired,
    timing: {}, ms: Math.round(performance.now() - started), usage: ctx.usage };
}

async function editPlan(original, edits, setup, ctx, offline = false, retimed = []) {
  const { plan, errors } = applyEdits(original, Array.isArray(edits) ? edits : []);
  const routes = {};
  for (const [index, row] of plan.days.entries()) {
    if (retimed.includes(index) || JSON.stringify(row) !== JSON.stringify(original.days[index])) {
      const rendered = await schedule(row, index, setup, ctx, [], new Set(), { keep: true, offline });
      plan.days[index] = rendered.day;
      Object.assign(routes, rendered.routes);
    }
    for (const [i, stop] of plan.days[index].stops.entries()) {
      if (i && stop.leg && !routes[stop.leg.key]) routes[stop.leg.key] = stop.leg.geometry ?? [plan.days[index].stops[i - 1].ll, stop.ll];
    }
  }
  plan.setup = setup;
  plan.checks = checks(plan, setup);
  return { plan, routes, errors };
}
export function validatePlan(plan) {
  if (!Array.isArray(plan?.days) || !plan.days.length || plan.days.length > 7 || plan.days.some(day =>
    !Array.isArray(day?.stops) || day.stops.length > 30 || day.stops.some(stop =>
      typeof stop?.id !== 'string' || !coordinates(stop.ll) || !validTime(stop.start) || !validTime(stop.end)))) throw bad('แผนทริปไม่ถูกต้อง');
  return plan;
}
export async function replan(input, ctx) {
  const started = performance.now();
  const original = validatePlan(input.plan);
  const command = cleanName(input.command);
  if (!command) throw bad('ไม่มีคำสั่ง');
  const setup = normalize(input.setup ?? original.setup);
  setup.cityLL ??= original.days.flatMap(day => day.stops)[0]?.ll;
  const day = Math.min(original.days.length - 1, Math.max(0, Number.isInteger(input.day) ? input.day : 0));
  ctx.step('Bop กำลังปรับเฉพาะจุดที่ได้รับผลกระทบ');
  const offline = input.demo === true || provider === 'fake';
  let answer;
  if (offline) {
    const stops = original.days.flatMap(row => row.stops);
    const target = stops.find(stop => command.includes(stop.name)) ?? (/ฝน|น้ำตก/.test(command)
      ? stops.find(stop => stop.kind === 'nature') : original.days[day].stops.find(stop => stop.kind === 'food'));
    const edits = target ? [/ตัด|เอาออก/.test(command) ? { op: 'remove', id: target.id }
      : { op: 'replace', id: target.id, stop: indoor(target) }] : [];
    answer = { options: [{ title: 'ปรับแผนเฉพาะจุด', edits }] };
    if (target?.kind === 'food' && /เต็ม|ปิด/.test(command)) {
      answer.options = [
        { title: 'หาร้านใกล้จุดเดิม', vote_reason: 'เพิ่มงบเพื่อรักษาเวลา', edits: [{
          op: 'replace', id: target.id, stop: { ...target, name: 'ร้านอาหารใกล้ตลาด (ตัวอย่าง)', cost: target.cost + 450 },
        }] },
        { title: 'แวะตลาดแทน', vote_reason: 'รักษางบและเปลี่ยนรูปแบบมื้ออาหาร', edits: [{
          op: 'replace', id: target.id, stop: { ...target, name: 'มื้ออาหารที่ตลาด (ตัวอย่าง)', cost: target.cost },
        }] },
      ];
    }
    if (/เที่ยวบิน.*ช้า|ดีเลย์/.test(command)) answer = { options: [{ title: 'เลื่อนเวลาเริ่มทริป', edits: [], transport: { dir: 'go', by: 'flight', carrier: 'ตัวอย่าง', dep: '10:30', arr: '12:00' } }] };
  } else {
    answer = (await model('ปรับแผนให้น้อยที่สุด เก็บจุด res.done คืน {summary,day,options:[{title,head,vote_reason,edits:[{op,id,stop}],transport?:{dir,by,carrier,code,from,to,dep,arr}}]} เสนอ 2–3 ทางเฉพาะเมื่อมี trade-off', { plan: original, setup, day, command }, { ...ctx, searches: 2 })).value;
  }
  const options = [];
  const routes = {};
  let tradeoff = false;
  let repaired = false;
  const oldChecks = checks(original, setup);
  for (const [index, row] of (answer.options ?? []).slice(0, 3).entries()) {
    const optionSetup = structuredClone(setup);
    const retimed = [];
    const change = row.transport;
    const selected = transportOption(change, 'changed-' + index, new Set());
    const base = structuredClone(original);
    if (selected && ['go', 'back'].includes(change.dir)) {
      const going = change.dir === 'go';
      const leg = going ? optionSetup.arrive : optionSetup.depart;
      base.flags ??= {};
      base.flags.transport ??= {};
      const prior = base.flags.transport[change.dir]?.options ?? [];
      leg.choice = prior.find(item => (selected.code && selected.code === item.code) || (selected.carrier === item.carrier && selected.dep === item.dep)) ?? selected;
      leg.time = going ? leg.choice.arr : leg.choice.dep;
      leg.by = leg.choice.by;
      base.flags.transport[change.dir] = { chosen: leg.choice, options: prior.includes(leg.choice) ? prior : [...prior, leg.choice] };
      retimed.push(going ? 0 : original.days.length - 1);
      if (!going) {
        const last = base.days.at(-1).stops.at(-1);
        if (last) last.start = last.end = clock(minutes(leg.time) - (leg.by === 'flight' ? 90 : 40));
      }
    }
    let updated = await editPlan(base, row.edits, optionSetup, ctx, offline, retimed);
    const newlyFailed = plan => plan.checks.filter(item => !item.pass && oldChecks.find(old => old.id === item.id)?.pass);
    if (!offline && (updated.errors.length || newlyFailed(updated.plan).some(check => !check.id.includes('/')))) {
      try {
        const match = await model('แก้ข้อผิดพลาดเฉพาะจุด คืน {edits:[{op,id,stop}]}', { plan: updated.plan, errors: updated.errors, checks: newlyFailed(updated.plan) }, ctx);
        const retry = await editPlan(updated.plan, match.value.edits, optionSetup, ctx);
        if (score(retry.plan.checks) >= score(updated.plan.checks)) { updated = retry; repaired = true; }
      } catch (error) { if (protectedError(error)) throw error; }
    }
    const delta = Math.round(total(updated.plan) - total(original));
    const memberFailure = newlyFailed(updated.plan).some(check => check.id.includes('/'));
    const lostWish = setup.members.flatMap(member => member.wants).some(wish => original.days.some(day => day.stops.some(stop => stop.name === wish))
      && !updated.plan.days.some(day => day.stops.some(stop => stop.name === wish)));
    tradeoff ||= delta > 300 || memberFailure || lostWish;
    const key = 'ABC'[index];
    for (const stop of updated.plan.days.flatMap(item => item.stops)) {
      if (!stop.leg) continue;
      const routeKey = stop.leg.key;
      stop.leg.key = key + ':' + routeKey;
      routes[stop.leg.key] = updated.routes[routeKey];
    }
    const title = cleanName(row.title) || 'ทางเลือก ' + key;
    ctx.step('ทางเลือก ' + key + ': ตรวจเงื่อนไข ผ่าน ' + updated.plan.checks.filter(check => check.pass).length + '/' + updated.plan.checks.length + ' · ฿' + delta + '/คน');
    options.push({ key, title, head: cleanName(row.head) || title, line: 'Bop: ' + title + '\nค่าใช้จ่ายเปลี่ยน ฿' + delta + '/คน\nผู้จัดทริปตรวจเวลาใหม่', plan: updated.plan, vote_reason: cleanName(row.vote_reason) });
  }
  if (!options.length) throw new Error('No options');
  const needs_vote = tradeoff && options.length > 1;
  return { options: needs_vote ? options : options.slice(0, 1), needs_vote, day, routes,
    summary: cleanName(answer.summary) || 'ปรับแผนแล้ว', setup: options[0].plan.setup, ms: Math.round(performance.now() - started), repaired };
}
