import {
  acquireOperation,
  releaseOperation,
  uncertainOperation,
  completeOperation,
  auditOrder,
  auditCancellation,
} from './operation-store.mjs';

const fault = (code, message, extra) => Object.assign(new Error(message), { code, extra });
const endpoint = 'https://api.duffel.com';
const rates = new Map();
let requests = 0;
let searchDate = '';
let consecutiveFailures = 0;
let retryAfter = 0;
export function flightCapabilities() {
  const match = /^duffel_(test|live)_/.exec(process.env.DUFFEL_ACCESS_TOKEN || '');
  return match
    ? { mode: match[1], booking: match[1] === 'test' || process.env.BOP_FLIGHT_BOOKING === '1' }
    : null;
}
async function supplier(path, ctx, data, idempotency) {
  const url = new URL(path, endpoint);
  const reply = await fetch(url, {
    method: data === undefined ? 'GET' : 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Duffel-Version': 'v2',
      Authorization: 'Bearer ' + process.env.DUFFEL_ACCESS_TOKEN,
      ...(idempotency ? { 'Idempotency-Key': idempotency } : {}),
    },
    signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(25000)]),
    redirect: 'error',
    ...(data === undefined ? {} : { body: JSON.stringify({ data }) }),
  });
  if (!reply.ok) {
    if (reply.status === 429) retryAfter = Date.now() + 600000;
    const errors = (await reply.json().catch(() => ({}))).errors || [];
    if (errors.some((error) => /offer.*(expired|unavailable)|offer_no_longer_available/.test(error.code))) {
      throw fault('offer_expired', 'ข้อเสนอหมดอายุ กรุณาค้นหาเที่ยวบินใหม่');
    }
    throw fault(reply.status === 429 ? 'rate_limit' : 'upstream', 'บริการเที่ยวบินทำรายการไม่สำเร็จ');
  }
  return (await reply.json()).data;
}
async function baht(amount, currency, signal) {
  if (currency === 'THB') return Number(amount);
  let rate = rates.get(currency);
  if (!rate || rate.until < Date.now()) {
    try {
      const response = await fetch(
        'https://api.frankfurter.app/latest?from=' + encodeURIComponent(currency) + '&to=THB',
        { signal: AbortSignal.any([signal, AbortSignal.timeout(2200)]) },
      );
      if (!response.ok) throw new Error();
      const price = (await response.json()).rates?.THB;
      if (!Number.isFinite(price) || price <= 0) throw new Error();
      rate = { price, until: Date.now() + 43200000 };
      rates.set(currency, rate);
    } catch {
      signal.throwIfAborted();
      rate = { price: { USD: 35, EUR: 38, GBP: 45, JPY: 0.23, SGD: 26, VND: 0.0014 }[currency] };
    }
  }
  return rate.price ? Math.round(Number(amount) * rate.price) : null;
}
async function money(amount, currency, signal) {
  if (amount == null || !Number.isFinite(Number(amount)) || !currency) return null;
  return { amount: Number(amount), currency, thb: await baht(amount, currency, signal) };
}
function ident(value, prefix) {
  if (typeof value !== 'string' || !new RegExp('^' + prefix + '_[A-Za-z0-9]+$').test(value))
    throw fault('bad_request', 'รหัสรายการเที่ยวบินไม่ถูกต้อง');
  return value;
}
async function airport(text, hint, ctx) {
  const name = String(text || '').trim();
  const literal = name.match(/\b([A-Z]{3})\b/)?.[1];
  if (literal || /^[A-Z]{3}$/.test(hint)) return literal || hint;
  if (/กรุงเทพ|bangkok/i.test(name)) return 'BKK';
  if (!name) return null;
  const suggestions = await supplier('/places/suggestions?query=' + encodeURIComponent(name), ctx);
  return suggestions?.find((place) => /^[A-Z]{3}$/.test(place.iata_code))?.iata_code;
}
const codes = { กรุงเทพฯ: 'BKK', เชียงใหม่: 'CNX', ดานัง: 'DAD', โตเกียว: 'HND', ไทเป: 'TPE', โซล: 'ICN' };
const timeOf = (iso) => String(iso ?? '').slice(11, 16);
async function optionFrom(raw, dir, members, ctx) {
  const [slice] = raw.slices || [];
  if (!slice?.segments?.length || raw.slices.length !== 1 || !/^off_/.test(raw.id)) return null;
  const first = slice.segments[0],
    last = slice.segments.at(-1);
  const dep = timeOf(first.departing_at),
    arr = timeOf(last.arriving_at);
  const priceLocal = { amount: Number(raw.total_amount) / members, currency: raw.total_currency };
  const price = await baht(priceLocal.amount, priceLocal.currency, ctx.signal);
  const airline = first.marketing_carrier || first.operating_carrier || raw.owner || {};
  const stops = slice.segments.length - 1;
  const arrivalHour = Number(arr.slice(0, 2)),
    departureHour = Number(dep.slice(0, 2));
  const fits =
    dir === 'go' ? arrivalHour >= 7 && arrivalHour < 12 : departureHour >= 18 && departureHour < 22;
  const duration = slice.duration ?? '';
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(duration);
  const durationMinutes = match ? Number(match[1] || 0) * 60 + Number(match[2] || 0) : 1440;
  return {
    by: 'flight',
    offerId: raw.id,
    expiresAt: raw.expires_at,
    checked: 'live',
    src: { title: 'Duffel', url: '' },
    bookable: true,
    test: flightCapabilities()?.mode === 'test',
    carrier: airline.name || '',
    code:
      (airline.iata_code || '') +
      (first.marketing_carrier_flight_number ?? first.operating_carrier_flight_number ?? ''),
    from: first.origin?.iata_code,
    to: last.destination?.iata_code,
    dep,
    arr,
    stops,
    duration,
    bag: bagText(first),
    conditions: terms(raw),
    price,
    priceLocal,
    durationMinutes,
    score: (price ?? 100000) + stops * 1800 + (fits ? 0 : 2000),
  };
}
function bagText(segment) {
  return (segment?.passengers?.[0]?.baggages || []).map((bag) => bag.type + ' × ' + bag.quantity).join(', ');
}
function terms(raw) {
  return Object.entries(raw.conditions || {})
    .filter(([, v]) => typeof v?.allowed === 'boolean')
    .map(([key, v]) => key + ': ' + (v.allowed ? 'ได้' : 'ไม่ได้'))
    .join(', ');
}
export async function searchFlights(setup, dir, ctx) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== searchDate) {
    requests = 0;
    searchDate = today;
  }
  if (
    !flightCapabilities() ||
    Date.now() < retryAfter ||
    requests >= Number(process.env.BOP_DUFFEL_DAILY_SEARCHES || 200)
  )
    return [];
  try {
    const city = await airport(setup.city, setup.cityAirport || setup.airport || codes[setup.city], ctx);
    const going = dir === 'go';
    const home = await airport(going ? setup.arrive?.from : setup.depart?.to, null, ctx);
    if (!city || !home || city === home) return [];
    requests++;
    const members = Math.max(1, setup.members.length);
    const result = await supplier('/air/offer_requests?return_offers=true', ctx, {
      slices: [
        {
          origin: going ? home : city,
          destination: going ? city : home,
          departure_date: going ? setup.startDate : setup.endDate,
        },
      ],
      passengers: Array.from({ length: members }, () => ({ type: 'adult' })),
      cabin_class: 'economy',
      max_connections: 1,
    });
    consecutiveFailures = 0;
    const unique = new Map();
    for (const offer of (result.offers || []).slice(0, 60)) {
      const row = await optionFrom(offer, dir, members, ctx);
      if (!row) continue;
      const key = row.code + '/' + row.dep;
      if (!unique.has(key) || (row.price ?? Infinity) < (unique.get(key).price ?? Infinity))
        unique.set(key, row);
    }
    const ranked = [...unique.values()].sort((a, b) => a.score - b.score);
    if (!ranked.length) return [];
    const best = (measure) => ranked.reduce((a, b) => (measure(a) <= measure(b) ? a : b));
    return [
      ...new Set([
        ranked[0],
        best((row) => row.price ?? Infinity),
        best((row) => row.durationMinutes),
        ...ranked,
      ]),
    ]
      .slice(0, 5)
      .map(({ score, ...row }, i) => ({
        ...row,
        id: dir + '-d' + (i + 1),
        recommended: i === 0,
        why: i === 0 ? 'เหมาะกับเวลาและงบของทริป' : '',
      }));
  } catch {
    ctx.signal.throwIfAborted();
    if (++consecutiveFailures >= 2) retryAfter = Date.now() + 600000;
    return [];
  }
}
async function refresh(id, ctx) {
  const raw = await supplier('/air/offers/' + ident(id, 'off') + '?return_available_services=true', ctx);
  const termsOfPayment = raw.payment_requirements || {};
  const seats = raw.passengers?.map((passenger) => ({ id: passenger.id })) || [];
  const services = [];
  for (const service of raw.available_services || []) {
    if (service.type !== 'baggage') continue;
    services.push({
      id: service.id,
      type: service.type,
      price: await money(service.total_amount, service.total_currency, ctx.signal),
      maximumQuantity: service.maximum_quantity ?? 1,
      passengerIds: service.passenger_ids || [],
      weightKg: service.metadata?.maximum_weight_kg,
    });
  }
  const legs = raw.slices?.flatMap((slice) => slice.segments) || [];
  return {
    ...flightCapabilities(),
    bookable: flightCapabilities().booking,
    services,
    offer: {
      offerId: raw.id,
      expiresAt: raw.expires_at,
      total: await money(raw.total_amount, raw.total_currency, ctx.signal),
      passengers: seats,
      from: legs[0]?.origin?.iata_code,
      to: legs.at(-1)?.destination?.iata_code,
      dep: legs[0]?.departing_at,
      arr: legs.at(-1)?.arriving_at,
      bag: bagText(legs[0]),
      conditions: terms(raw),
      identityDocumentsRequired: raw.passenger_identity_documents_required === true,
      instantOnly: termsOfPayment.requires_instant_payment !== false,
      payBy: termsOfPayment.payment_required_by ?? null,
    },
  };
}
function manifest(rows, offer) {
  const expected = new Set(offer.passengers.map((p) => p.id));
  if (
    !Array.isArray(rows) ||
    rows.length !== expected.size ||
    !expected.size ||
    offer.identityDocumentsRequired
  ) {
    throw fault('bad_request', 'ข้อมูลผู้โดยสารไม่ตรงกับข้อเสนอ หรือเที่ยวบินต้องใช้หนังสือเดินทาง');
  }
  return rows.map((row) => {
    const phone = String(row.phone_number || '').replace(/[ -]/g, '');
    if (
      !expected.delete(row.id) ||
      !['mr', 'mrs', 'ms', 'miss', 'dr'].includes(row.title) ||
      !['m', 'f'].includes(row.gender) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.born_on) ||
      ![row.given_name, row.family_name].every(
        (name) => typeof name === 'string' && /^[A-Za-z][A-Za-z '\-]{0,39}$/.test(name),
      ) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) ||
      !/^\+[1-9]\d{7,14}$/.test(phone)
    )
      throw fault('bad_request', 'กรุณาตรวจข้อมูลผู้โดยสาร');
    return {
      id: row.id,
      title: row.title,
      given_name: row.given_name,
      family_name: row.family_name,
      born_on: row.born_on,
      gender: row.gender,
      email: row.email,
      phone_number: phone,
    };
  });
}
async function mutation(input, action, prepare, submit, audit) {
  const key = input.idempotencyKey;
  const claim = await acquireOperation(key, { action, ...input });
  if (claim.replay) return claim.replay;
  let request;
  try {
    request = await prepare();
  } catch (error) {
    if (claim.persisted) await releaseOperation(key);
    throw error;
  }
  let result;
  try {
    result = await submit(request);
  } catch (error) {
    if (claim.persisted) await uncertainOperation(key, 'supplier outcome unknown');
    throw error;
  }
  try {
    await audit(result);
    if (claim.persisted) await completeOperation(key, result);
  } catch {
    if (claim.persisted) await uncertainOperation(key, 'local write failed').catch(() => {});
  }
  return result;
}
export async function flightOperation(action, input, ctx) {
  const capabilities = flightCapabilities();
  if (!capabilities) throw fault('no_key', 'Bop ยังไม่ได้เปิดบริการเที่ยวบิน');
  if (action === 'offer') return refresh(input.offerId, ctx);
  if (!capabilities.booking) throw fault('not_enabled', 'ยังไม่ได้เปิดการจองเที่ยวบินจริง');
  if (action === 'order') {
    return mutation(
      input,
      action,
      async () => {
        const { offer, services } = await refresh(input.offerId, ctx);
        if (!offer.total || !['instant', 'hold'].includes(input.type))
          throw fault('bad_request', 'กรุณาตรวจประเภทรายการและราคาก่อนยืนยัน');
        const passengers = manifest(input.passengers, offer);
        if (input.type === 'hold' && offer.instantOnly && input.approveInstant !== true)
          throw fault('bad_request', 'เที่ยวบินนี้ต้องชำระทันที กรุณายืนยันราคาสำหรับการจองทันที');
        const type = input.type === 'hold' && !offer.instantOnly ? 'hold' : 'instant';
        const bags = [];
        let amount = offer.total.amount;
        for (const service of services) {
          const count = Number(input.services?.find((item) => item.id === service.id)?.quantity);
          if (type === 'hold' || !Number.isInteger(count) || count <= 0) continue;
          if (service.price?.currency !== offer.total.currency)
            throw fault('bad_request', 'สกุลเงินของสัมภาระไม่ตรงกับตั๋ว');
          const quantity = Math.min(count, service.maximumQuantity);
          bags.push({ id: service.id, quantity });
          amount += quantity * service.price.amount;
        }
        if (
          input.approvedTotal?.currency !== offer.total.currency ||
          !Number.isFinite(Number(input.approvedTotal.amount)) ||
          Math.abs(Number(input.approvedTotal.amount) - amount) > 0.00001
        ) {
          throw fault('price_changed', 'ราคาเที่ยวบินเปลี่ยน กรุณาตรวจราคาอีกครั้ง', {
            total: await money(amount, offer.total.currency, ctx.signal),
          });
        }
        return {
          type,
          selected_offers: [offer.offerId],
          passengers,
          ...(type === 'instant'
            ? {
                payments: [{ type: 'balance', amount: amount.toFixed(2), currency: offer.total.currency }],
                services: bags,
              }
            : {}),
        };
      },
      async (request) => {
        const order = await supplier('/air/orders', ctx, request, input.idempotencyKey);
        return {
          order: {
            orderId: order.id,
            bookingReference: order.booking_reference,
            offerId: input.offerId,
            mode: capabilities.mode,
            type: request.type,
            total: Number(order.total_amount),
            currency: order.total_currency,
            totalTHB: await baht(order.total_amount, order.total_currency, ctx.signal),
            createdAt: order.created_at,
            payBy: order.payment_status?.payment_required_by ?? null,
          },
        };
      },
      (result) => auditOrder(result.order),
    );
  }
  ident(input.orderId, 'ord');
  if (!input.cancellationId) {
    const quote = await supplier('/air/order_cancellations', ctx, { order_id: input.orderId });
    return {
      quote: {
        cancellationId: quote.id,
        refund: await money(quote.refund_amount, quote.refund_currency, ctx.signal),
        refundTo: quote.refund_to,
        expiresAt: quote.expires_at,
      },
    };
  }
  ident(input.cancellationId, 'ore');
  return mutation(
    input,
    action,
    async () => {
      const quote = await supplier('/air/order_cancellations/' + input.cancellationId, ctx);
      if (quote.order_id !== input.orderId) throw fault('bad_request', 'ใบเสนอการยกเลิกไม่ตรงกับการจอง');
      return quote;
    },
    async (quote) => {
      const confirmed = await supplier(
        '/air/order_cancellations/' + quote.id + '/actions/confirm',
        ctx,
        {},
        input.idempotencyKey,
      );
      return {
        cancelled: {
          orderId: input.orderId,
          confirmedAt: confirmed.confirmed_at,
          refund: await money(confirmed.refund_amount, confirmed.refund_currency, ctx.signal),
        },
      };
    },
    (result) => auditCancellation(input.orderId, result.cancelled.confirmedAt),
  );
}
