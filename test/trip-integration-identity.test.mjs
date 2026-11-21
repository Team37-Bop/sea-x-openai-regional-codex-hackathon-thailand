import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

test('resizing a linked trip retains its LINE session and flight receipt through undo and reset', async (t) => {
  const setup = { city: 'เชียงใหม่', startDate: '2026-12-01', endDate: '2026-12-03', members: [] };
  const legacyKey = JSON.stringify([setup.city, setup.startDate, setup.endDate, []]);
  const auth = { tripId: 'linked-trip', organizerToken: 'test-organizer' };
  const storage = new Map([['bop.line.organizer.v1', JSON.stringify({ [legacyKey]: auth })]]);
  const element = () => ({
    children: [],
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    contains(node) { return this.children.includes(node); },
    querySelector() { return null; },
    addEventListener() {},
    setAttribute() {},
  });
  const globals = {
    document: { createElement: element },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  };
  for (const [name, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  const posts = [];
  let configReads = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/api/config') {
      configReads++;
      return Response.json({ enabled: true });
    }
    if (url.endsWith('/post')) {
      posts.push({ url, token: options.headers['x-bop-trip-token'], data: JSON.parse(options.body) });
      return Response.json({ posted: true });
    }
    assert.equal(url, '/api/trips/' + auth.tripId);
    assert.equal(options.headers['x-bop-trip-token'], auth.organizerToken);
    return Response.json({ linked: true, title: setup.city });
  });
  const { bindTripIntegrations, canNotifyWeather, newTripIntegrationKey, renderAppliedLine, renderTripIntegrations } =
    await import('../web/trip-integrations.js');
  const { publicLineConfig } = await import('../web/stream.js');
  const setupConfig = publicLineConfig();
  const receipt = { orderId: 'ord_test', bookingReference: 'BOOKED' };
  const initial = { localTripId: 'original-link', setup, plan: { days: [], flags: { transport: { back: { order: receipt } } } } };
  bindTripIntegrations(initial);
  const first = element();
  renderTripIntegrations(first, initial);
  await setImmediate();
  assert.ok((await setupConfig).enabled);
  assert.equal(configReads, 1);
  assert.ok(canNotifyWeather(initial));
  const [flight, line] = first.children;
  assert.ok(flight.children.some(node => node.textContent?.includes('BOOKED')));

  const resized = { ...initial, localTripId: 'revised-link', setup: { ...setup, endDate: '2026-12-05' }, plan: { days: [] } };
  bindTripIntegrations(resized);
  const result = element();
  renderAppliedLine(result, initial, resized, 'ปรับวันกลับ', false);
  const reopened = { localTripId: resized.localTripId, plan: resized.plan, setup: resized.setup };
  bindTripIntegrations(reopened);
  for (const state of [resized, structuredClone(initial), resized, structuredClone(initial), reopened]) {
    const rendered = element();
    renderTripIntegrations(rendered, state);
    assert.ok(canNotifyWeather(state));
    assert.equal(rendered.children[0], flight);
    assert.equal(rendered.children[1], line);
  }
  await setImmediate();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/api/trips/' + auth.tripId + '/post');
  assert.equal(posts[0].token, auth.organizerToken);
  assert.equal(posts[0].data.text, 'Bop: ปรับวันกลับ');
  renderAppliedLine(result, initial, resized, 'ผลโหวต', true);
  await setImmediate();
  assert.equal(posts.length, 1);

  const independent = { localTripId: 'another-link', setup, plan: { days: [] }, integrationKey: newTripIntegrationKey() };
  bindTripIntegrations(independent);
  const independentReopened = { localTripId: independent.localTripId, setup, plan: independent.plan };
  bindTripIntegrations(independentReopened);
  assert.equal(independentReopened.integrationKey, independent.integrationKey);
  for (const state of [independent, independentReopened]) {
    const rendered = element();
    renderTripIntegrations(rendered, state);
    assert.equal(canNotifyWeather(state), false);
    assert.equal(rendered.children.length, 1);
    assert.notEqual(rendered.children[0], line);
    renderAppliedLine(result, state, { ...state }, 'แผนทริปใหม่', false);
    await setImmediate();
    assert.equal(posts.length, 1);
  }
  for (const otherSetup of [resized.setup, { ...setup, title: 'อีกทริป' }]) {
    const other = { setup: otherSetup, plan: { days: [] } };
    bindTripIntegrations(other);
    const rendered = element();
    renderTripIntegrations(rendered, other);
    assert.equal(canNotifyWeather(other), false);
    assert.equal(rendered.children.length, 1);
    assert.notEqual(rendered.children[0], line);
  }
});
