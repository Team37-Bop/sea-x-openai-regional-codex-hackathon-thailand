import { dateAt, minutes, validTime, clock } from './domain.mjs';

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const first = (stop) => stop.t0 ?? stop.start;
const last = (stop) => stop.t1 ?? stop.end;
const mode = (stop) => stop.leg?.m ?? stop.leg?.mode;
const money = (stop) => num(stop.cost) + num(stop.leg?.cost);
const round1 = (n) => Math.round(n * 10) / 10;
export function dayStats(day) {
  return {
    cost: day.stops.reduce((sum, s) => sum + money(s), 0),
    walk: round1(
      day.stops.reduce(
        (sum, s) => sum + num(s.walk ?? s.walkKm) + (mode(s) === 'walk' ? num(s.leg.km) : 0),
        0,
      ),
    ),
  };
}
export const total = (plan) => plan.days.reduce((sum, d) => sum + dayStats(d).cost, 0);
const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const thai = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const numDay = (d) => (Number.isInteger(d) ? d : weekdays.indexOf(String(d).slice(0, 3).toLowerCase()));
function hoursFor(s, wd) {
  const spec = s.days?.hours?.[weekdays[wd]] ?? s.hours?.[wd] ?? s.hours?.default ?? s.open;
  const pair = typeof spec === 'string' ? spec.match(/\d{1,2}:\d{2}/g) : spec;
  if (
    !Array.isArray(pair) ||
    pair.length < 2 ||
    !pair.slice(0, 2).every((t) => validTime(t) || t === '24:00')
  )
    return null;
  return pair;
}
function withinHours(s, pair) {
  let [open, close] = pair.map(minutes);
  let a = minutes(first(s)),
    b = minutes(last(s));
  if (b < a) b += 1440;
  if (close < open) {
    close += 1440;
    if (a < open) {
      a += 1440;
      b += 1440;
    }
  }
  return a >= open && b <= close;
}
const price = (n) => '฿' + Math.round(n).toLocaleString('en-US');
export const sampleMembers = [
  { id: 'member-1', name: 'มิน', budget: 2600 },
  { id: 'member-2', name: 'ต้น', maxWalkKm: 4 },
  { id: 'member-3', name: 'ฟ้า', avoid: 'มังสวิรัติ' },
  { id: 'member-4', name: 'ก้อง', wants: ['ประตูท่าแพ'] },
];
export function checks(
  plan,
  setup = plan.setup ?? {
    members: sampleMembers,
    startDate: plan.days[0]?.date,
    depart: { by: 'flight', time: '20:30' },
  },
) {
  const ds = plan.days.map(dayStats);
  const trip = ds.reduce((sum, d) => sum + d.cost, 0);
  const maxWalk = Math.max(0, ...ds.map((d) => d.walk));
  const list = [],
    mem = Object.create(null);
  const all = plan.days.flatMap((d, index) => d.stops.map((s) => ({ s, index })));
  const ref = (s, index) => (s.n ?? s.name) + ' (วันที่ ' + (index + 1) + ', id ' + s.id + ')';
  const add = (id, label, problems, member) =>
    list.push({
      id,
      label,
      pass: !problems.length,
      ok: !problems.length,
      problems,
      ...(member ? { member: member.name, memberId: member.id } : {}),
    });
  for (const m of setup.members ?? []) {
    const from = list.length;
    if (m.wants?.length) {
      const found = all.filter(({ s }) => s.star === m.id).length;
      add(
        m.id + '/wishes',
        'ที่อยากไป ' + m.wants.length + ' แห่ง',
        found < m.wants.length ? ['จัดให้ ' + found + '/' + m.wants.length + ' แห่ง'] : [],
        m,
      );
    }
    const avoid = m.avoid || (m.veg ? 'เนื้อสัตว์ (กินมังสวิรัติ)' : '');
    if (avoid)
      add(
        m.id + '/food',
        'ไม่ทาน ' + avoid,
        all
          .filter(
            ({ s }) =>
              (s.meal || (s.k ?? s.kind) === 'food') &&
              !(Array.isArray(s.diet) ? s.diet.length > 0 : s.diet) &&
              !(s.veg && /มังสวิรัติ|วีแกน|vegetarian|vegan|กินเจ/i.test(avoid)),
          )
          .map(({ s, index }) => ref(s, index) + ' ยังไม่ระบุเมนูที่ทานได้'),
        m,
      );
    if (m.maxWalkKm > 0)
      add(
        m.id + '/walk',
        'เดิน ≤ ' + m.maxWalkKm + ' กม./วัน',
        ds.flatMap((d, i) =>
          d.walk > m.maxWalkKm
            ? ['วันที่ ' + (i + 1) + ' เดินรวม ' + d.walk.toFixed(1) + ' กม. (เกิน ' + m.maxWalkKm + ')']
            : [],
        ),
        m,
      );
    if (m.budget > 0)
      add(
        m.id + '/budget',
        'งบ ' + price(m.budget),
        trip > m.budget ? [price(trip) + ' เกินงบ ' + price(trip - m.budget)] : [],
        m,
      );
    const own = list.slice(from),
      failures = own.filter((rule) => !rule.pass);
    mem[m.id] = {
      ok: !failures.length,
      txt: failures.length
        ? failures.flatMap((rule) => rule.problems).join(' · ')
        : own.map((r) => r.label).join(' · ') || 'ไม่มีเงื่อนไขพิเศษ',
    };
  }
  const hourIssues = [],
    dayIssues = [],
    mealIssues = [],
    driveIssues = [];
  for (const [index, d] of plan.days.entries()) {
    const date = setup.startDate ? dateAt(setup.startDate, index) : d.date;
    const wd = new Date(date + 'T00:00:00Z').getUTCDay();
    for (const s of d.stops) {
      const hours = hoursFor(s, wd);
      if (hours && !withinHours(s, hours))
        hourIssues.push(ref(s, index) + ' ' + first(s) + '–' + last(s) + ' เปิด ' + hours.join('–'));
      const only = s.days?.only?.map(numDay),
        closed = (s.days?.closed ?? s.closedDays ?? []).map(numDay);
      const closure = (s.closures ?? []).find((item) => (item?.date ?? item) === date);
      const problem =
        only?.length && !only.includes(wd)
          ? 'เปิดเฉพาะวัน' + only.map((k) => thai[k]).join('/')
          : closed.includes(wd)
            ? 'ปิดวัน' + thai[wd]
            : closure
              ? 'ปิดวันที่ ' + date + (closure.why ? ' (' + closure.why + ')' : '')
              : '';
      if (problem)
        dayIssues.push(
          (s.n ?? s.name) +
            ' ' +
            problem +
            ' (วันที่ ' +
            (index + 1) +
            ', วัน' +
            thai[wd] +
            ' ' +
            date +
            ', id ' +
            s.id +
            ')',
        );
    }
    const arrive = setup.arrive?.time,
      depart = setup.depart?.time;
    const lunchExempt =
      (index === 0 && arrive > '13:00') || (index === plan.days.length - 1 && depart && depart < '13:00');
    const dinnerExempt = index === plan.days.length - 1 && depart && depart < '19:30';
    if (
      !lunchExempt &&
      !d.stops.some((s) => s.meal === 'lunch' && first(s) >= '11:00' && first(s) <= '14:00')
    )
      mealIssues.push('วันที่ ' + (index + 1) + ' ไม่มีมื้อกลางวัน 11:00–14:00');
    if (
      !dinnerExempt &&
      !d.stops.some((s) => s.meal === 'dinner' && first(s) <= '20:30' && last(s) >= '17:30')
    )
      mealIssues.push('วันที่ ' + (index + 1) + ' ไม่มีมื้อเย็น 17:30–20:30');
    const driving = d.stops.reduce((sum, s) => sum + (mode(s) === 'own' ? num(s.leg.min) : 0), 0);
    if (driving > 480) driveIssues.push('วันที่ ' + (index + 1) + ' ขับรถ ' + driving + ' นาที');
  }
  add('hours', 'เวลาเปิด–ปิด', hourIssues);
  add('open-days', 'เปิดวันที่ไป', dayIssues);
  add('meals', 'มื้อกลางวัน–เย็นครบ', mealIssues);
  const end = plan.days.at(-1)?.stops.at(-1);
  const by = setup.depart?.by === 'undecided' ? plan.flags?.arrivalSuggested?.by : setup.depart?.by;
  if (end && validTime(setup.depart?.time) && ['flight', 'train', 'bus'].includes(by)) {
    const buffer = by === 'flight' ? 75 : 30;
    const spare = minutes(setup.depart.time) - minutes(first(end));
    const label =
      (by === 'flight'
        ? 'ถึงสนามบินก่อนไฟลต์'
        : by === 'train'
          ? 'ถึงสถานีก่อนรถไฟออก'
          : 'ถึงสถานีก่อนรถออก') +
      ' ' +
      spare +
      ' นาที';
    add(
      'departure',
      label,
      spare < buffer
        ? [ref(end, plan.days.length - 1) + ' ต้องถึงภายใน ' + clock(minutes(setup.depart.time) - buffer)]
        : [],
    );
  }
  if ([setup.arrive?.by, setup.depart?.by].includes('drive')) {
    add('drive-time', 'ขับรถไม่เกิน 8 ชม./วัน', driveIssues);
    if (end && mode(end) === 'own' && end.leg.km >= 50)
      add(
        'drive-home',
        'ถึงบ้านภายใน 22:00',
        first(end) > '22:00' ? [ref(end, plan.days.length - 1) + ' ถึงบ้าน ' + first(end)] : [],
      );
  }
  return { mem, list, pass: list.filter((r) => r.pass).length, total: trip, maxWalk, ds };
}
export const explain = (plan, setup) =>
  checks(plan, setup)
    .list.filter((row) => !row.pass)
    .map((row) => ({ ...row, reason: [row.member, row.label, ...row.problems].filter(Boolean).join(' · ') }));
