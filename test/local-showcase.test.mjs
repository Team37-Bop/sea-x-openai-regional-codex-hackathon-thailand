import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('local demo links survive restart and are readable only over loopback', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'bop-showcase-'));
  const keys = ['BOP_CACHE_DIR', 'BOP_LOCAL_DEMO', 'AWS_LAMBDA_FUNCTION_NAME'];
  const old = keys.map((k) => process.env[k]);
  Object.assign(process.env, { BOP_CACHE_DIR: root, BOP_LOCAL_DEMO: '1' });
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  t.after(async () => {
    keys.forEach((k, i) => {
      if (old[i] === undefined) delete process.env[k];
      else process.env[k] = old[i];
    });
    await rm(root, { recursive: true, force: true });
  });
  const { saveLocalTrip } = await import('../server/local-showcase.mjs');
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:1234' } };
  const score = { passed: 3, total: 3, failures: [] };
  const trip = { plan: {
    setup: { title: 'วันหยุดกับเพื่อน' }, days: [{ stops: [] }],
    repairOutcome: { status: 'applied', before: { passed: 2, total: 3, failures: [{ id: 'meal', label: 'มื้อเย็น' }] }, after: score, changes: ['วันที่ 1 · เพิ่มมื้อเย็น'] },
  }, routes: {} };
  const ids = await Promise.all(Array.from({ length: 9 }, () => saveLocalTrip(req, trip)));
  assert.equal((await readdir(join(root, 'showcase'))).length, 8);
  const { readLocalTrip } = await import('../server/local-showcase.mjs?restarted');
  assert.deepEqual(await readLocalTrip(req, ids.at(-1)), trip);
  assert.equal(
    await readLocalTrip({ ...req, headers: { host: 'untrusted.example' } }, ids.at(-1)),
    undefined,
  );
  process.env.AWS_LAMBDA_FUNCTION_NAME = 'bop-test';
  assert.equal(await readLocalTrip(req, ids.at(-1)), undefined);
});

test('one verified lodging revision is reused across local requests and restarts, retaining the original', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'bop-showcase-lodging-'));
  const prior = { ...process.env };
  Object.assign(process.env, { BOP_CACHE_DIR: root, BOP_LOCAL_DEMO: '1' });
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  t.after(async () => {
    for (const key of ['BOP_CACHE_DIR', 'BOP_LOCAL_DEMO', 'AWS_LAMBDA_FUNCTION_NAME']) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
    await rm(root, { recursive: true, force: true });
  });
  const { readFile } = await import('node:fs/promises');
  const { readLocalTrip, saveLocalTrip, resolveLocalLodging, localLodgingOffers } = await import('../server/local-showcase.mjs');
  const { needsAutoLodging } = await import('../web/lodging-state.js');
  const request = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost' } };
  const plan = { setup: { stay: { mode: 'auto' } }, days: [{ stops: [] }, { stops: [] }], flags: { stay: { area: 'Waterloo' } } };
  const original = { plan, routes: {} };
  assert.ok(needsAutoLodging(plan));
  for (const manual of [{ mode: 'booked' }, { mode: 'auto', name: 'My Place' }, { mode: 'auto', stays: [{ name: 'My Place' }] }])
    assert.equal(needsAutoLodging({ ...plan, setup: { stay: manual } }), false);
  assert.equal(needsAutoLodging({ ...plan, days: [plan.days[0]] }), false);
  const id = await saveLocalTrip(request, original);
  const offered = {options:[{id:'hotel-1',name:'Riverside Hotel'}],recommendedId:'hotel-1',area:'River'};
  assert.deepEqual(await localLodgingOffers(request,id,async()=>offered),offered);
  assert.deepEqual(await readLocalTrip(request,id),original);
  assert.deepEqual(JSON.parse(await readFile(join(root,'showcase',id+'.json'),'utf8')),original);
  await assert.rejects(resolveLocalLodging(request, id, () => Promise.reject(Error('retry'))), /retry/);
  assert.deepEqual(await readLocalTrip(request, id), original);
  const upgraded = structuredClone(original);
  upgraded.plan.flags.stay.stays = [{ name: 'Riverside Hotel', ll: [51.5, -0.1], recommended: true }];
  assert.equal(needsAutoLodging(upgraded.plan), false);
  let calls = 0, release;
  const gate = new Promise(done => { release = done; });
  const lookup = async () => { calls++; await gate; return upgraded; };
  const jobs = [resolveLocalLodging(request, id, lookup), resolveLocalLodging(request, id, lookup)];
  release();
  assert.deepEqual(await Promise.all(jobs), [upgraded, upgraded]);
  assert.equal(calls, 1);
  const disk = JSON.parse(await readFile(join(root, 'showcase', id + '.json'), 'utf8'));
  assert.deepEqual(disk.plan, original.plan);
  assert.deepEqual(disk.lodgingRevision, upgraded);
  const restarted = await import('../server/local-showcase.mjs?lodging-restart');
  assert.deepEqual(await restarted.localLodgingOffers(request,id,()=>assert.fail('lookup after reload')),offered);
  assert.deepEqual(await restarted.readLocalTrip(request, id), upgraded);
  assert.deepEqual(await restarted.resolveLocalLodging(request, id, () => assert.fail('unexpected provider call')), upgraded);
  assert.equal(await restarted.resolveLocalLodging({ ...request, headers: { host: 'elsewhere' } }, id, lookup), undefined);
  const confirmed = structuredClone(upgraded);
  confirmed.plan.flags.stay.selection = 'chosen';
  assert.deepEqual(await restarted.resolveLocalLodging(request,id,current=>{
    assert.deepEqual(current,upgraded);
    return confirmed;
  },'choose-hotel-1'),confirmed);
  const final = JSON.parse(await readFile(join(root,'showcase',id+'.json'),'utf8'));
  assert.deepEqual(final.plan, original.plan);
  assert.deepEqual(final.lodgingRevision, confirmed);
});
