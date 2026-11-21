// Duffel integration checks against a local mock of the Duffel API (no network, no token needed).
// Usage: node scripts/test-duffel.mjs
import http from 'node:http';

let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail++; };

/* ---- mock Duffel ---- */
const seen = [];
let mode = 'ok';
const seg = (code, dep, arr, o = 'DMK', d = 'CNX') => ({ origin: { iata_code: o }, destination: { iata_code: d }, departing_at: `2026-11-20T${dep}:00`, arriving_at: `2026-11-20T${arr}:00`,
  marketing_carrier: { iata_code: 'ZZ', name: 'Duffel Airways' }, marketing_carrier_flight_number: code, passengers: [{ baggages: [{ type: 'checked', quantity: 1 }] }] });
const offer = (id, amt, segs, dur = 'PT1H15M') => ({ id, total_amount: amt, total_currency: 'USD', expires_at: '2026-11-20T00:30:00Z', owner: { name: 'Duffel Airways', iata_code: 'ZZ' },
  slices: [{ duration: dur, segments: segs }], conditions: { refund_before_departure: { allowed: false }, change_before_departure: { allowed: true } } });
const OFFERS = [
  offer('off_late', '100.00', [seg('101', '17:00', '18:15')]),
  offer('off_fit', '160.00', [seg('102', '07:30', '08:45')]),
  offer('off_fit_dup', '170.00', [seg('102', '07:30', '08:45')]),
  offer('off_cheap', '80.00', [seg('103', '05:00', '06:10')]),
  offer('off_conn', '90.00', [seg('104', '06:00', '07:00', 'DMK', 'HKT'), seg('105', '08:00', '09:30', 'HKT', 'CNX')], 'PT3H30M'),
];
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, ver: req.headers['duffel-version'], body: b ? JSON.parse(b) : null });
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (mode === 'down') return send(500, { errors: [{ code: 'internal_server_error', message: 'boom' }] });
    if (req.url.startsWith('/places/suggestions')) return send(200, { data: [{ type: 'city', iata_code: 'CNX', iata_city_code: 'CNX' }] });
    if (req.url.startsWith('/air/offer_requests')) return send(200, { data: { offers: mode === 'empty' ? [] : OFFERS } });
    if (req.url.startsWith('/air/offers/off_fit')) return send(200, { data: { ...OFFERS[1], passengers: [{ id: 'pas_1', type: 'adult' }, { id: 'pas_2', type: 'adult' }],
      payment_requirements: { requires_instant_payment: false, payment_required_by: '2026-11-15T10:00:00Z' }, passenger_identity_documents_required: false,
      available_services: [{ id: 'ase_bag1', type: 'baggage', total_amount: '20.00', total_currency: 'USD', maximum_quantity: 2, passenger_ids: ['pas_1'], metadata: { maximum_weight_kg: 23 } }] } });
    if (req.url.startsWith('/air/offers/')) return send(404, { errors: [{ code: 'offer_no_longer_available', message: 'gone' }] });
    if (req.url === '/air/orders') return send(201, { data: { id: 'ord_1', booking_reference: 'RZPVXY', total_amount: '200.00', total_currency: 'USD' } });
    if (req.url === '/air/order_cancellations') return send(201, { data: { id: 'ore_1', refund_amount: '150.00', refund_currency: 'USD', refund_to: 'balance', expires_at: '2026-11-10T00:00:00Z' } });
    if (req.url === '/air/order_cancellations/ore_1/actions/confirm') return send(200, { data: { id: 'ore_1', confirmed_at: '2026-11-09T10:00:00Z', refund_amount: '150.00', refund_currency: 'USD' } });
    send(404, { errors: [{ code: 'not_found', message: 'nope' }] });
  });
});
await new Promise(r => srv.listen(0, r));
process.env.BOP_DUFFEL_API = `http://127.0.0.1:${srv.address().port}`;
process.env.BOP_NO_STORE = '1';
delete process.env.DUFFEL_ACCESS_TOKEN; delete process.env.BOP_FLIGHT_BOOKING;
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => String(u).includes('frankfurter') ? Promise.resolve(new Response(JSON.stringify({ rates: { USD: 1 / 33 } }), { headers: { 'content-type': 'application/json' } })) : realFetch(u, o);

const D = await import('../server/duffel.mjs');
const setup = { startDate: '2026-11-20', days: 3, city: 'เชียงใหม่', cityAirport: 'CNX', members: [{ name: 'มิ้น' }, { name: 'ปาล์ม' }], arrive: { by: 'flight', from: 'DMK' }, depart: { by: 'flight', to: 'DMK' } };
const quiet = { warn() {}, info() {} };

ok((await D.searchFlights({ setup, dir: 'go', log: quiet })).length === 0 && seen.length === 0, 'no token: no Duffel call, []');

process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
const steps = [];
const opts = await D.searchFlights({ setup, dir: 'go', emit: t => steps.push(t), log: quiet });
const req = seen.find(x => x.url.startsWith('/air/offer_requests'));
ok(req && req.auth === 'Bearer duffel_test_x' && req.ver === 'v2', 'bearer token + Duffel-Version v2');
ok(req && req.body.data.slices[0].origin === 'DMK' && req.body.data.slices[0].destination === 'CNX' && req.body.data.slices[0].departure_date === '2026-11-20', 'go slice DMK→CNX on start date');
ok(req && req.body.data.passengers.length === 2 && req.body.data.max_connections === 1, 'one adult per member, max 1 connection');
ok(opts[0] && opts[0].offerId === 'off_fit' && opts[0].recommended, `recommended = best fit to the morning arrival (${opts[0] && opts[0].offerId})`);
ok(!opts.some(o => o.offerId === 'off_fit_dup'), 'same flight number deduped (cheapest kept)');
ok(opts[0].price === Math.round(160 / 2 * 33) && opts[0].priceLocal.currency === 'USD' && opts[0].priceLocal.amount === 80, `per-person THB from USD total (${opts[0].price})`);
ok(opts.every(o => o.checked === 'live' && o.bookable && o.test && /^off_/.test(o.offerId)), 'options are live, bookable, test');
ok(opts.find(o => o.offerId === 'off_conn')?.stops === 1, 'connection counted');
ok(opts.length <= 5, 'at most 5 options');

seen.length = 0;
await D.searchFlights({ setup, dir: 'back', log: quiet });
const rb = seen.find(x => x.url.startsWith('/air/offer_requests'));
ok(rb && rb.body.data.slices[0].origin === 'CNX' && rb.body.data.slices[0].destination === 'DMK' && rb.body.data.slices[0].departure_date === '2026-11-22', 'back slice CNX→DMK on last day');

seen.length = 0;
await D.searchFlights({ setup: { ...setup, cityAirport: undefined, city: 'Chiang Mai' }, dir: 'go', log: quiet });
ok(seen[0] && seen[0].url.startsWith('/places/suggestions'), 'city without airport code resolved via places suggestions');

mode = 'empty';
ok((await D.searchFlights({ setup: { ...setup, startDate: '2026-11-21' }, dir: 'go', log: quiet })).length === 0, 'no offers -> [] (web search fallback)');

// offer refresh
mode = 'ok';
const off = await D.runFlightOffer({ offerId: 'off_fit' });
ok(off.offer.passengers.length === 2 && off.services[0].id === 'ase_bag1' && off.services[0].price.thb === 660, 'offer refresh: passengers + bag service in THB');
ok(off.offer.instantOnly === false && off.offer.payBy, 'hold allowed with pay-by date');
let e = null; try { await D.runFlightOffer({ offerId: 'off_gone' }); } catch (x) { e = x; }
ok(e && e.code === 'offer_expired', 'expired offer -> offer_expired');

// order
const pax = [
  { id: 'pas_1', title: 'ms', given_name: 'Min', family_name: 'Test', born_on: '1999-01-01', gender: 'f', email: 'min@example.com', phone_number: '+66812345678' },
  { id: 'pas_2', title: 'mr', given_name: 'Palm', family_name: 'Test', born_on: '1999-02-02', gender: 'm', email: 'palm@example.com', phone_number: '+66 81-234-5679' },
];
e = null; try { await D.runFlightOrder({ body: { offerId: 'off_fit', passengers: pax, services: [{ id: 'ase_bag1', quantity: 1 }], approved: { amount: '160.00', currency: 'USD' } }, log: quiet }); } catch (x) { e = x; }
ok(e && e.code === 'price_changed' && e.extra.total.amount === '180.00', 'approved total without the bag -> price_changed with new total');
e = null; try { await D.runFlightOrder({ body: { offerId: 'off_fit', passengers: [{ ...pax[0], given_name: 'มิ้น' }, pax[1]], approved: { amount: '160.00', currency: 'USD' } }, log: quiet }); } catch (x) { e = x; }
ok(e && e.code === 'bad_request', 'Thai-script name rejected (passport name in English)');
seen.length = 0;
const ord = await D.runFlightOrder({ body: { offerId: 'off_fit', passengers: pax, services: [{ id: 'ase_bag1', quantity: 1 }], approved: { amount: '180.00', currency: 'USD' } }, log: quiet });
const ob = seen.find(x => x.url === '/air/orders');
ok(ob && ob.body.data.type === 'instant' && ob.body.data.payments[0].amount === '180.00' && ob.body.data.payments[0].type === 'balance', 'instant order paid from balance with the approved total');
ok(ob && ob.body.data.services[0].id === 'ase_bag1' && ob.body.data.passengers[1].phone_number === '+66812345679', 'bag service + cleaned phone sent');
ok(ord.order.bookingReference === 'RZPVXY' && ord.order.orderId === 'ord_1', 'booking reference returned');
seen.length = 0;
await D.runFlightOrder({ body: { offerId: 'off_fit', passengers: pax, hold: true, approved: { amount: '160.00', currency: 'USD' } }, log: quiet });
const hb = seen.find(x => x.url === '/air/orders');
ok(hb && hb.body.data.type === 'hold' && !hb.body.data.payments, 'hold order has no payment');

// cancel
const q = await D.runFlightCancel({ body: { orderId: 'ord_1' } });
ok(q.quote.cancellationId === 'ore_1' && q.quote.refund.amount === '150.00', 'cancel quote with refund');
const c = await D.runFlightCancel({ body: { orderId: 'ord_1', confirm: 'ore_1' } });
ok(c.cancelled.confirmedAt === '2026-11-09T10:00:00Z', 'cancel confirmed');

// live token: search ok, booking off unless BOP_FLIGHT_BOOKING=1
process.env.DUFFEL_ACCESS_TOKEN = 'duffel_live_x';
e = null; try { await D.runFlightOrder({ body: { offerId: 'off_fit', passengers: pax, approved: { amount: '160.00', currency: 'USD' } }, log: quiet }); } catch (x) { e = x; }
ok(e && e.code === 'not_enabled' && !D.bookingEnabled(), 'live token: booking disabled by default');
process.env.BOP_FLIGHT_BOOKING = '1';
ok(D.bookingEnabled(), 'live token + BOP_FLIGHT_BOOKING=1 enables booking');
process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';

// Duffel down twice -> [] then breaker
mode = 'down';
const s1 = await D.searchFlights({ setup: { ...setup, startDate: '2026-11-25' }, dir: 'go', log: quiet });
await D.searchFlights({ setup: { ...setup, startDate: '2026-11-26' }, dir: 'go', log: quiet });
seen.length = 0;
const s3 = await D.searchFlights({ setup: { ...setup, startDate: '2026-11-27' }, dir: 'go', log: quiet });
ok(s1.length === 0 && s3.length === 0 && seen.length === 0, 'Duffel 500 -> [] and breaker skips further calls');

srv.close();
console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
