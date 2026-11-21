import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flightCapabilities, flightOperation, searchFlights } from '../server/flights.mjs';

test('supplier search uses group, dates and per-person price; reprice, hold, instant and cancellation respect consent', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const path = new URL(url).pathname;
    const payload = opts.body && JSON.parse(opts.body).data;
    requests.push({ path, payload, method: opts.method });
    let data;
    if (path === '/air/offer_requests')
      data = { offers: [offer, { ...offer, id: 'off_2', total_amount: '3800.00' }] };
    else if (path === '/air/offers/off_1') data = offer;
    else if (path === '/air/orders')
      data = { id: 'ord_1', booking_reference: 'TEST01', total_currency: 'THB', total_amount: '3500.00' };
    else if (path === '/air/order_cancellations')
      data = { id: 'ore_1', refund_amount: '100', refund_currency: 'THB' };
    else if (path === '/air/order_cancellations/ore_1') data = { id: 'ore_1', order_id: 'ord_1' };
    else if (path === '/air/order_cancellations/ore_1/actions/confirm')
      data = { id: 'ore_1', confirmed_at: '2026-11-21T03:00:00Z' };
    else throw Error(path);
    return Response.json({ data });
  });
  const old = process.env.DUFFEL_ACCESS_TOKEN;
  const oldStore = process.env.BOP_NO_STORE;
  process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_fixture';
  process.env.BOP_NO_STORE = '1';
  t.after(() => {
    for (const [k, v] of Object.entries({ DUFFEL_ACCESS_TOKEN: old, BOP_NO_STORE: oldStore })) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const requests = [];
  const ctx = { signal: new AbortController().signal };
  const offer = {
    id: 'off_1',
    slices: [
      {
        duration: 'PT1H',
        segments: [
          {
            departing_at: '2026-11-23T19:00:00',
            arriving_at: '2026-11-23T20:00:00',
            origin: { iata_code: 'CNX' },
            destination: { iata_code: 'DMK' },
            marketing_carrier: { iata_code: 'XX', name: 'Example' },
            marketing_carrier_flight_number: '12',
          },
        ],
      },
    ],
    total_amount: '3500.00',
    total_currency: 'THB',
    passengers: [{ id: 'pas_1' }, { id: 'pas_2' }],
    payment_requirements: { requires_instant_payment: false },
    available_services: [
      { id: 'ase_1', type: 'baggage', total_amount: '200', total_currency: 'THB', maximum_quantity: 1 },
    ],
  };
  const setup = {
    city: 'เชียงใหม่',
    cityAirport: 'CNX',
    startDate: '2026-11-21',
    endDate: '2026-11-23',
    depart: { to: 'DMK' },
    members: [{}, {}],
  };
  const options = await searchFlights(setup, 'back', ctx);
  assert.equal(options.length, 1);
  assert.equal(options[0].price, 1750);
  assert.equal(options[0].recommended, true);
  assert.equal(requests[0].payload.passengers.length, 2);
  assert.deepEqual(requests[0].payload.slices, [
    { origin: 'CNX', destination: 'DMK', departure_date: '2026-11-23' },
  ]);
  assert.equal((await flightOperation('offer', { offerId: 'off_1' }, ctx)).offer.total.amount, 3500);
  const passengers = offer.passengers.map(({ id }) => ({
    id,
    title: 'mr',
    gender: 'm',
    given_name: 'Sample',
    family_name: 'Traveler',
    born_on: '1998-12-01',
    phone_number: '+66 81-2345678',
    email: 'sample@example.invalid',
  }));
  const purchase = {
    offerId: 'off_1',
    type: 'instant',
    passengers,
    services: [{ id: 'ase_1', quantity: 10 }],
    approvedTotal: { amount: 3500, currency: 'THB' },
    idempotencyKey: crypto.randomUUID(),
  };
  await assert.rejects(
    () => flightOperation('order', purchase, ctx),
    (e) => e.code === 'price_changed' && e.extra.total.amount === 3700,
  );
  assert.equal(
    requests.some((r) => r.path === '/air/orders'),
    false,
  );
  const hold = await flightOperation('order', { ...purchase, type: 'hold' }, ctx);
  assert.equal(hold.order.type, 'hold');
  assert.equal(requests.at(-1).payload.payments, undefined);
  assert.equal(requests.at(-1).payload.services, undefined);
  offer.payment_requirements.requires_instant_payment = true;
  await assert.rejects(() => flightOperation('order', { ...purchase, type: 'hold' }, ctx), {
    code: 'bad_request',
  });
  const instant = await flightOperation(
    'order',
    { ...purchase, approvedTotal: { amount: 3700, currency: 'THB' } },
    ctx,
  );
  assert.equal(instant.order.currency, 'THB');
  assert.equal(requests.at(-1).payload.payments[0].amount, '3700.00');
  assert.deepEqual(requests.at(-1).payload.services, [{ id: 'ase_1', quantity: 1 }]);
  const quote = await flightOperation('cancel', { orderId: 'ord_1' }, ctx);
  assert.equal(quote.quote.refund.amount, 100);
  assert.equal(
    requests.some((r) => r.path.endsWith('confirm')),
    false,
  );
  const cancel = await flightOperation(
    'cancel',
    { orderId: 'ord_1', cancellationId: quote.quote.cancellationId, idempotencyKey: crypto.randomUUID() },
    ctx,
  );
  assert.equal(cancel.cancelled.orderId, 'ord_1');
  process.env.DUFFEL_ACCESS_TOKEN = 'duffel_live_fixture';
  assert.deepEqual(flightCapabilities(), { booking: false, mode: 'live' });
  await assert.rejects(() => flightOperation('order', purchase, ctx), { code: 'not_enabled' });
});
