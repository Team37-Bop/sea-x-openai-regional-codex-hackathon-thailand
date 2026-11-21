import { coordinates } from './domain.mjs';
export function fields(row) {
  const { visitFacts, ...copy } = row;
  if (visitFacts) {
    for (const key of ['walkin', 'dress'])
      if (typeof visitFacts[key] === 'boolean') copy[key] = visitFacts[key];
    if (typeof visitFacts.legWhy === 'string' && visitFacts.legWhy.trim()) copy.legWhy = visitFacts.legWhy.trim();
    if (Array.isArray(visitFacts.restStops) && visitFacts.restStops.length) copy.restStops = visitFacts.restStops;
  }
  for (const [key, alias] of [
    ['n', 'name'],
    ['k', 'kind'],
    ['t0', 'start'],
    ['t1', 'end'],
  ]) {
    if (row[key] !== undefined || row[alias] !== undefined) copy[key] = copy[alias] = row[key] ?? row[alias];
  }
  return copy;
}
export function uniqueId(value, ids) {
  let id = value;
  for (let i = 2; ids.has(id); i++) id = value + '_' + i;
  ids.add(id);
  return id;
}
export function applyEdits(plan, edits) {
  const next = structuredClone(plan),
    errors = [];
  next.flags ??= {};
  const ids = new Set(next.days.flatMap((d) => d.stops.map((s) => s.id)));
  for (const e of Array.isArray(edits) ? edits : []) {
    if (!e || typeof e !== 'object') {
      errors.push('คำสั่งแก้ไขไม่ถูกต้อง');
      continue;
    }
    if (e.op === 'flag') {
      if (typeof e.key === 'string' && !['__proto__', 'prototype', 'constructor'].includes(e.key))
        next.flags[e.key] = e.value;
      else errors.push('ไม่พบชื่อ flag');
      continue;
    }
    const anchored = e.after ?? e.afterId ?? e.id;
    const day = Number.isInteger(e.day)
      ? next.days[e.day]
      : next.days.find((d) => d.stops.some((s) => s.id === anchored));
    if (!day) {
      errors.push('ไม่พบ ' + (anchored ?? 'วันที่ระบุ'));
      continue;
    }
    const index = day.stops.findIndex((s) => s.id === (e.op === 'insert' ? anchored : e.id));
    if (index < 0 && (e.op !== 'insert' || anchored)) {
      errors.push('ไม่พบ ' + (anchored ?? e.id));
      continue;
    }
    const stop = day.stops[index],
      replacement = e.stop ?? e.spec;
    if (e.op === 'remove') {
      if (stop.res?.done) errors.push('จองแล้ว: ' + (stop.n ?? stop.name) + ' (id ' + stop.id + ')');
      day.stops.splice(index, 1);
      ids.delete(stop.id);
    } else if (e.op === 'replace' && replacement) {
      const change = fields(replacement);
      if (change.leg) change.mode = change.mode ?? change.leg.m ?? change.leg.mode;
      const result = { ...stop, ...change, id: stop.id };
      if (
        (change.n && change.n !== (stop.n ?? stop.name)) ||
        (coordinates(change.ll) && String(change.ll) !== String(stop.ll))
      ) {
        if (!coordinates(change.ll)) delete result.ll;
        if (!change.query) delete result.query;
        delete result.place;
        delete result.catalogId;
        delete result.pinned;
        if (!Object.hasOwn(change, 'src')) delete result.src;
      }
      day.stops[index] = result;
    } else if (e.op === 'insert' && replacement) {
      day.stops.splice(index + 1, 0, {
        ...fields(replacement),
        id: uniqueId(replacement.id || 'added', ids),
      });
    } else errors.push('คำสั่งแก้ไขไม่ถูกต้อง ' + (e.op ?? ''));
  }
  return { plan: next, errors };
}
