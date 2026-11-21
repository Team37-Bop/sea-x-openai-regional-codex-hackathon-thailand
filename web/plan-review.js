import { el } from './integration-ui.js';

const currency = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  maximumFractionDigits: 0,
});
const amount = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const format = (value) => currency.format(value);
const signed = (value) => (value > 0 ? '+' : value < 0 ? '−' : '') + format(Math.abs(value));

export function renderRepairOutcome(container, outcome) {
  if (!['applied', 'kept'].includes(outcome?.status) || !outcome.before || !outcome.after) return;
  const applied = outcome.status === 'applied';
  const report = el('details', null, 'repair-outcome');
  const title = el('summary', applied ? 'Bop ปรับรายละเอียดแผนแล้ว' : 'Bop คงแผนก่อนแก้ไว้');
  const score = (result) => result.passed + '/' + result.total;
  title.append(el('small', 'ผ่าน ' + score(outcome.before) + ' → ' + score(outcome.after) + ' เงื่อนไข'));
  report.append(title);
  const explanation = {
    worse: 'วิธีที่ลองทำให้ผลตรวจโดยรวมแย่ลง',
    unavailable: 'Bop ลองแก้รายละเอียดแล้ว แต่ตรวจแผนที่แก้ไม่สำเร็จ',
    unchanged: 'การตรวจรอบนี้ไม่ได้เปลี่ยนกำหนดการหรือรายละเอียดทริป',
  };
  if (!applied && explanation[outcome.reason]) report.append(el('p', explanation[outcome.reason]));
  function list(label, rows) {
    if (!rows.length) return;
    const items = el('ul');
    for (const row of rows) items.append(el('li', row));
    report.append(el('strong', label), items);
  }
  list('สิ่งที่ปรับในแผน', outcome.changes || []);
  const prior = outcome.before.failures || [], final = outcome.after.failures || [];
  const remaining = new Set(final.map((rule) => rule.id));
  const failedAtStart = new Set(prior.map((rule) => rule.id));
  const describe = (rule) => [rule.label, rule.detail].filter(Boolean).join(' · ');
  list('เงื่อนไขที่แก้จนผ่าน', prior.filter((rule) => !remaining.has(rule.id)).map(describe));
  list('เงื่อนไขที่ยังไม่ผ่าน', final.filter((rule) => failedAtStart.has(rule.id)).map(describe));
  list('เงื่อนไขที่เพิ่งไม่ผ่าน', final.filter((rule) => !failedAtStart.has(rule.id)).map(describe));
  container.append(report);
}

function visits(plan) {
  const result = new Map();
  for (const [index, day] of (plan?.days || []).entries()) {
    for (const [order, stop] of (day?.stops || []).entries()) {
      const name = stop.name || stop.n || 'จุดแวะ';
      const visit = {
        name,
        day: index + 1,
        date: day.date || '',
        start: stop.start || stop.t0 || '',
        end: stop.end || stop.t1 || '',
        cost: amount(stop.cost),
        fare: amount(stop.leg?.cost),
      };
      result.set(stop.id || `${index}/${order}/${name}`, visit);
    }
  }
  return result;
}
function total(list) {
  return [...list.values()].reduce((sum, visit) => sum + visit.cost + visit.fare, 0);
}
function failedRules(plan) {
  return (plan?.checks || plan?.report?.list || []).filter((check) => (check.pass ?? check.ok) === false);
}
function ruleId(check) {
  return check.id || [check.memberId || check.member || '', check.label].join('/');
}
export function describePlanChange(before, after) {
  const original = visits(before),
    proposed = visits(after),
    changes = [];
  for (const [id, next] of proposed) {
    const previous = original.get(id);
    const kinds = [];
    if (!previous) kinds.push('added');
    else {
      if (previous.name !== next.name) kinds.push('renamed');
      if (
        previous.day !== next.day ||
        previous.date !== next.date ||
        previous.start !== next.start ||
        previous.end !== next.end
      )
        kinds.push('retimed');
      if (previous.cost !== next.cost || previous.fare !== next.fare) kinds.push('price');
    }
    if (kinds.length) changes.push({ id, kinds, before: previous || null, after: next });
  }
  for (const [id, previous] of original) {
    if (!proposed.has(id)) changes.push({ id, kinds: ['removed'], before: previous, after: null });
  }
  const oldTotal = total(original),
    newTotal = total(proposed);
  const failures = new Set(failedRules(before).map(ruleId));
  return {
    oldTotal,
    newTotal,
    delta: newTotal - oldTotal,
    changes,
    newFailures: failedRules(after).filter((check) => !failures.has(ruleId(check))),
  };
}
function visitCell(visit, fallback) {
  const cell = el('td');
  if (!visit) {
    cell.textContent = fallback;
    return cell;
  }
  cell.append(el('strong', visit.name));
  const interval = [visit.start, visit.end !== visit.start && visit.end].filter(Boolean).join('–');
  cell.append(el('small', ['วันที่ ' + visit.day, interval].filter(Boolean).join(' · ')));
  cell.append(el('small', 'จุดแวะ ' + format(visit.cost) + ' · เดินทาง ' + format(visit.fare)));
  return cell;
}
const types = {
  added: 'เพิ่ม',
  removed: 'ตัดออก',
  renamed: 'เปลี่ยนสถานที่',
  retimed: 'เปลี่ยนเวลา',
  price: 'เปลี่ยนค่าใช้จ่าย',
};
function changesTable(changes) {
  const table = el('table', null, 'review-changes');
  const header = table.createTHead().insertRow();
  for (const title of ['รายการ', 'แผนเดิม', 'แผนที่เสนอ']) {
    const heading = el('th', title);
    heading.scope = 'col';
    header.append(heading);
  }
  const body = table.createTBody();
  for (const change of changes) {
    const row = body.insertRow();
    const category = el('th', change.kinds.map((kind) => types[kind]).join(' · '));
    category.scope = 'row';
    row.append(category, visitCell(change.before, 'ยังไม่มีจุดแวะนี้'), visitCell(change.after, 'นำออกจากแผน'));
  }
  return table;
}
export function renderPlanReview(container, beforePlan, option) {
  const diff = describePlanChange(beforePlan, option.plan);
  const review = el('section', null, 'plan-review');
  review.setAttribute('aria-label', 'เปรียบเทียบแผนเดิมกับทางเลือก ' + (option.key || ''));
  const totals = el('dl', null, 'review-totals');
  for (const [label, value] of [
    ['แผนเดิม / คน', format(diff.oldTotal)],
    ['แผนที่เสนอ / คน', format(diff.newTotal)],
    ['ส่วนต่าง / คน', signed(diff.delta)],
  ]) {
    const pair = el('div');
    pair.append(el('dt', label), el('dd', value));
    totals.append(pair);
  }
  review.append(totals);
  if (diff.changes.length) {
    const details = el('details');
    // Keep short changes visible and long cascading time shifts available on demand.
    details.open = diff.changes.length <= 3;
    details.append(el('summary', 'จุดแวะที่เปลี่ยน ' + diff.changes.length + ' แห่ง'), changesTable(diff.changes));
    review.append(details);
  } else review.append(el('p', 'จุดแวะ เวลา และค่าใช้จ่ายตามกำหนดการเดิม', 'muted'));
  if (diff.newFailures.length) {
    review.append(el('h4', 'เงื่อนไขที่เพิ่งไม่ผ่าน'));
    const list = el('ul');
    for (const rule of diff.newFailures) {
      const issue = [rule.member, rule.label, ...(rule.problems || [])].filter(Boolean).join(' · ');
      list.append(el('li', issue));
    }
    review.append(list);
  }
  container.append(review);
  return diff;
}
