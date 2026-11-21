import { visitDate } from './itinerary-facts.js';

const calendar = new Intl.DateTimeFormat('th-TH', {
  weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
});
const timeRange = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/;
const stopRef = /\(วันที่ (\d+)(?:, วัน[^,)]*? (\d{4}-\d{2}-\d{2}))?(?:, id ([^)]*))?\)/;
const dayPrefix = /^วันที่ (\d+)\s+/;
const stopName = (stop) => stop?.n || stop?.name || '';

function minutes(time) {
  if (!/^(?:[01]?\d|2[0-3]):[0-5]\d$|^24:00$/.test(time)) return NaN;
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function hoursDetail(visit, hours) {
  const scheduled = timeRange.exec(visit), window = timeRange.exec(hours);
  const evidence = 'แผน ' + visit + ' · เปิด ' + hours;
  if (!scheduled || !window) return 'ช่วงเวลาที่แวะไม่ตรงกับเวลาเปิด · ' + evidence;
  const [start, end, open, close] = [...scheduled.slice(1), ...window.slice(1)].map(minutes);
  if (![start, end, open, close].every(Number.isFinite) || close < open)
    return 'ช่วงเวลาที่แวะไม่ตรงกับเวลาเปิด · ' + evidence;
  const finish = end < start ? end + 1440 : end;
  if (start > close) return 'ถึงหลังปิด ' + (start - close) + ' นาที · ' + evidence;
  if (start === close && finish > close) return 'ถึงพอดีกับเวลาปิด · ' + evidence;
  const conflicts = [];
  if (start < open) conflicts.push('ถึงก่อนเปิด ' + (open - start) + ' นาที');
  if (finish > close) conflicts.push('จบหลังปิด ' + (finish - close) + ' นาที');
  return [...conflicts, evidence].join(' · ');
}

function mealIssue(issue, mealName, window, day) {
  issue.subject = mealName;
  issue.detail = 'ยังไม่มี' + mealName + 'ในช่วง ' + window;
  const meal = mealName === 'มื้อกลางวัน' ? 'lunch' : 'dinner';
  const candidates = day?.stops?.filter((stop) => stop.meal === meal);
  if (candidates?.length !== 1) return;
  const stop = candidates[0], times = timeRange.exec(window);
  if (!times) return;
  const [from, until] = times.slice(1).map(minutes);
  const start = stop.t0 ?? stop.start, end = stop.t1 ?? stop.end;
  const early = meal === 'lunch' ? start : end;
  const lateBy = minutes(start) - until, earlyBy = from - minutes(early);
  if (lateBy > 0)
    issue.detail = 'เริ่ม ' + start + ' เลยช่วง' + mealName + ' ' + window + ' ไป ' + lateBy + ' นาที';
  else if (earlyBy > 0)
    issue.detail = (meal === 'lunch' ? 'เริ่ม ' : 'จบ ') + early + ' ก่อนช่วง' + mealName + ' ' + window + ' ' + earlyBy + ' นาที';
  else return;
  if (stopName(stop)) issue.subject += 'ที่ ' + stopName(stop);
  issue.stopId = stop.id ?? null;
}

function presentIssue(problem, plan, setup) {
  // Repair reasons in saved plans carry a trip-day number and an internal stop reference.
  const ref = stopRef.exec(problem), prefix = dayPrefix.exec(problem);
  const number = Number(ref?.[1] ?? prefix?.[1]);
  const day = plan.days?.[number - 1];
  const date = ref?.[2] || (day && visitDate(day, number - 1, setup));
  const instant = Date.parse(date);
  const when = Number.isFinite(instant) ? calendar.format(instant) : number > 0 ? 'วันที่ ' + number + ' ของทริป' : '';
  const issue = { subject: '', when, detail: '', dayIndex: day ? number - 1 : null, stopId: null };
  if (prefix) {
    issue.detail = problem.slice(prefix[0].length);
    const meal = /^ไม่มี(มื้อกลางวัน|มื้อเย็น)\s+(\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2})$/.exec(issue.detail);
    if (meal) mealIssue(issue, meal[1], meal[2], day);
  } else if (ref) {
    const before = problem.slice(0, ref.index).trim(), after = problem.slice(ref.index + ref[0].length).trim();
    const stop = day?.stops?.find((s) => (ref[3] ? String(s.id) === ref[3] : stopName(s) === before));
    issue.stopId = stop?.id ?? null;
    const name = stopName(stop);
    if (after) {
      issue.subject = before;
      const hours = /^(\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}) เปิด (.+)$/.exec(after);
      issue.detail = hours ? hoursDetail(hours[1], hours[2]) : after;
    } else if (name && before.startsWith(name + ' ')) {
      issue.subject = name;
      issue.detail = before.slice(name.length).trim();
    } else {
      issue.detail = before;
    }
  } else {
    issue.detail = problem;
  }
  // Keep unfamiliar reason text readable even when an older reference has a different format.
  issue.detail = issue.detail.replace(/,\s*id\s+[^)]+(?=\))/gi, '');
  return issue;
}

export function presentChecks(plan, setup = plan?.setup) {
  const checks = Array.isArray(plan?.checks) ? plan.checks : plan?.report?.list;
  if (!Array.isArray(checks)) return [];
  return checks.map((check) => {
    const problems = Array.isArray(check.problems) ? check.problems : [check.problems];
    return {
      label: check.label || 'เงื่อนไขของกลุ่ม',
      member: check.member || '',
      pass: (check.pass ?? check.ok) === true,
      issues: problems.filter((value) => typeof value === 'string' && value.trim())
        .map((value) => presentIssue(value.trim(), plan, setup)),
    };
  });
}
