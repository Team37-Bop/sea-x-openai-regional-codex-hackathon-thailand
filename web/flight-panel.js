import { el, action, label, message } from './integration-ui.js';

const orders = new Map();
const activePanels = new Map();
const uncertainOrders = new Set();
const pendingMutations = new Set();
let currentTrip;
const directions = { go: 'ขาไป', back: 'ขากลับ' };
const displayMoney = (total) =>
  total
    ? new Intl.NumberFormat('th-TH', { maximumFractionDigits: 3 }).format(total.amount) +
      ' ' +
      total.currency +
      (total.currency !== 'THB' && total.thb != null
        ? ' (ประมาณ ฿' + total.thb.toLocaleString('th-TH') + ')'
        : '')
    : 'ยังไม่ทราบยอด';
async function flightApi(action, input) {
  const res = await fetch('/api/flights/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('ติดต่อบริการเที่ยวบินไม่ได้');
  const events = (await res.text())
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const end = events.findLast((x) => x.type === 'error' || x.type === 'done');
  if (end?.type !== 'done')
    throw Object.assign(new Error(end?.message || 'ไม่ได้รับผลการทำรายการ'), {
      code: end?.code,
      total: end?.total,
    });
  return end;
}
function inlinePage(panel, title, done) {
  const section = el('section', null, 'flight-editor');
  const heading = el('h4', title);
  heading.tabIndex = -1;
  const content = el('div');
  const close = action('ปิดรายละเอียด', () => {
    done();
    panel.host.querySelector('button')?.focus();
  });
  section.append(heading, content, close);
  panel.host.replaceChildren(section);
  heading.focus({ preventScroll: true });
  return { content, close, active: () => panel.host.contains(section), done, panel };
}
function selector(options) {
  const select = el('select');
  for (const [key, title] of options) {
    const item = el('option', title);
    item.value = key;
    select.append(item);
  }
  return select;
}
function input(type, maxLength) {
  const item = el('input');
  item.type = type;
  item.required = true;
  if (maxLength) item.maxLength = maxLength;
  return item;
}
function passengerForm(form, passenger, i, member) {
  const group = el('fieldset');
  group.className = 'flight-passenger';
  group.append(el('legend', 'ผู้โดยสาร ' + (i + 1) + (member?.name ? ' · ' + member.name : '')));
  const fields = {
    title: selector([
      ['', 'เลือกคำนำหน้า'],
      ['mr', 'Mr'],
      ['mrs', 'Mrs'],
      ['ms', 'Ms'],
      ['miss', 'Miss'],
      ['dr', 'Dr'],
    ]),
    given_name: input('text', 40),
    family_name: input('text', 40),
    born_on: input('date'),
    gender: selector([
      ['', 'เลือกเพศตามเอกสาร'],
      ['m', 'ชาย'],
      ['f', 'หญิง'],
    ]),
    email: input('email', 254),
    phone_number: input('tel', 24),
  };
  fields.title.required = fields.gender.required = true;
  fields.phone_number.pattern = '\\+[0-9 \\-]{8,22}';
  fields.given_name.pattern = "[A-Za-z][A-Za-z '\\-]{0,39}";
  fields.family_name.pattern = fields.given_name.pattern;
  fields.phone_number.placeholder = '+66812345678';
  const labels = [
    'คำนำหน้า',
    'ชื่อภาษาอังกฤษตามเอกสาร',
    'นามสกุลภาษาอังกฤษตามเอกสาร',
    'วันเกิด',
    'เพศตามเอกสาร',
    'อีเมล',
    'เบอร์โทรพร้อมรหัสประเทศ',
  ];
  Object.values(fields).forEach((field, index) => group.append(label(labels[index], field)));
  form.append(group);
  return () => ({
    id: passenger.id ?? passenger,
    ...Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.value.trim()])),
  });
}
function showReview(page, details, save) {
  const { offer, services, mode, bookable } = details;
  const { content, close, panel } = page;
  const heading = () =>
    el(
      'p',
      [
        mode === 'test' ? 'ทดสอบการจอง' : 'เที่ยวบินจริง',
        offer.from + ' → ' + offer.to,
        offer.dep?.replace('T', ' '),
        displayMoney(offer.total) + ' ทั้งกลุ่ม',
      ].join(' · '),
    );
  content.replaceChildren(heading());
  for (const note of [
    offer.bag,
    offer.conditions,
    offer.payBy && 'ชำระภายใน ' + offer.payBy,
    offer.expiresAt && 'ข้อเสนอหมดอายุ ' + offer.expiresAt,
  ])
    if (note) content.append(el('p', note));
  if (!bookable || offer.identityDocumentsRequired) {
    content.append(
      el(
        'p',
        offer.identityDocumentsRequired
          ? 'เที่ยวบินนี้ต้องใช้ข้อมูลหนังสือเดินทาง กรุณาเลือกเที่ยวบินอื่น'
          : 'บริการนี้เปิดให้ค้นหาราคาเที่ยวบิน',
      ),
    );
    return;
  }
  content.append(el('p', 'กรอกข้อมูลตามเอกสารเดินทางสำหรับผู้โดยสาร ' + offer.passengers.length + ' คน', 'muted'));
  const form = el('form');
  const gather = offer.passengers.map((p, i) => passengerForm(form, p, i, panel.members[i]));
  const type = selector(
    offer.instantOnly
      ? [['instant', 'จองและชำระทันที']]
      : [
          ['instant', 'จองและชำระทันที'],
          ['hold', 'พักการจองไว้ชำระภายหลัง'],
        ],
  );
  form.append(label('ประเภทการจอง', type));
  const bags = el('fieldset');
  bags.append(el('legend', 'สัมภาระเพิ่มเติม'));
  const selections = [];
  for (const service of services || []) {
    const quantity = input('number');
    quantity.value = '0';
    quantity.min = '0';
    quantity.max = service.maximumQuantity;
    const indices = service.passengerIds
      ?.map((id) => offer.passengers.findIndex((p) => p.id === id) + 1)
      .filter(Boolean);
    bags.append(
      label(
        [
          service.weightKg ? service.weightKg + ' กก.' : 'กระเป๋าโหลด',
          indices?.length && 'ผู้โดยสาร ' + indices.join(', '),
          displayMoney(service.price) + ' / ใบ',
        ]
          .filter(Boolean)
          .join(' · '),
        quantity,
      ),
    );
    selections.push({ service, quantity });
  }
  if (selections.length) form.append(bags);
  type.addEventListener('change', () => {
    bags.disabled = type.value === 'hold';
    bags.hidden = bags.disabled;
  });
  const review = el('button', 'ตรวจสอบยอดก่อนยืนยัน', 'primary');
  form.append(review);
  content.append(form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const passengers = gather.map((read) => read());
    const choices = type.value === 'hold' ? [] : selections.filter((x) => Number(x.quantity.value) > 0);
    const bagTotal = choices.reduce(
      (sum, item) => sum + item.service.price.amount * Number(item.quantity.value),
      0,
    );
    const approvedTotal = {
      amount: Number((Number(offer.total.amount) + bagTotal).toFixed(4)),
      currency: offer.total.currency,
    };
    const operation = {
      idempotencyKey: crypto.randomUUID(),
      offerId: offer.offerId,
      type: type.value,
      passengers,
      approvedTotal,
      services: choices.map((x) => ({ id: x.service.id, quantity: Number(x.quantity.value) })),
    };
    const reviewArea = el('section');
    reviewArea.append(
      heading(),
      el('h3', type.value === 'hold' ? 'ยืนยันพักการจอง' : 'ยืนยันจองและชำระเงิน'),
      el('p', passengers.map((p) => p.given_name + ' ' + p.family_name).join(' · ')),
      el(
        'p',
        'สัมภาระเพิ่ม ' +
          choices.reduce((sum, item) => sum + Number(item.quantity.value), 0) +
          ' ใบ · ' +
          displayMoney({ amount: bagTotal, currency: offer.total.currency }),
      ),
      el('p', 'ยอดยืนยันทั้งกลุ่ม ' + displayMoney(approvedTotal)),
    );
    const back = action('แก้ไขข้อมูล', () => {
      form.hidden = false;
      reviewArea.remove();
    });
    const output = message(reviewArea);
    const confirm = action(
      mode === 'test' ? 'ยืนยันการจองทดสอบ' : 'ยืนยันทำรายการ',
      async () => {
        if (pendingMutations.has(panel.id)) return;
        pendingMutations.add(panel.id);
        back.disabled = close.disabled = true;
        let mayEdit = true;
        try {
          const { order } = await flightApi('order', operation);
          form.reset();
          content.replaceChildren();
          save(order);
        } catch (err) {
          output.textContent = err.message + (err.total ? ' · ยอดใหม่ ' + displayMoney(err.total) : '');
          if (err.code === 'price_changed' || err.code === 'offer_expired') {
            confirm.hidden = true;
            back.hidden = true;
            if (err.code === 'price_changed')
              reviewArea.append(
                action('ตรวจข้อเสนอและยืนยันยอดใหม่', async () => {
                  try {
                    showReview(page, await flightApi('offer', { offerId: offer.offerId }), save);
                  } catch (e) {
                    output.textContent = e.message;
                  }
                }),
              );
          } else if (!['bad_request', 'no_key', 'not_enabled', 'auth'].includes(err.code)) {
            mayEdit = false;
            uncertainOrders.add(panel.id);
            confirm.hidden = true;
            output.textContent += ' · กรุณาตรวจสอบผลการจองกับผู้ให้บริการก่อนทำรายการใหม่';
          }
        } finally {
          pendingMutations.delete(panel.id);
          close.disabled = false;
          back.disabled = !mayEdit;
          refreshReceipt(panel);
        }
      },
      'primary',
    );
    reviewArea.append(back, confirm);
    form.hidden = true;
    content.append(reviewArea);
  });
}
async function openOffer(panel, dir, option, save, done) {
  const page = inlinePage(panel, 'ตรวจสอบเที่ยวบิน' + directions[dir], done);
  page.content.append(el('p', 'กำลังตรวจราคาล่าสุด'));
  try {
    const details = await flightApi('offer', { offerId: option.offerId });
    if (page.active()) showReview(page, details, save);
  } catch (err) {
    page.content.replaceChildren(el('p', err.message));
  }
}
async function cancelOrder(panel, order, save, done) {
  const { active, content, close } = inlinePage(panel, 'ตรวจสอบยอดคืนก่อนยกเลิก', done);
  const output = message(content);
  try {
    const { quote } = await flightApi('cancel', { orderId: order.orderId });
    if (!active()) return;
    content.append(
      el(
        'p',
        [
          order.bookingReference,
          'ยอดคืน ' + displayMoney(quote.refund),
          quote.refundTo,
          quote.expiresAt && 'หมดอายุ ' + quote.expiresAt,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
    );
    const idempotencyKey = crypto.randomUUID();
    const keep = action('เก็บการจองไว้', done);
    const confirm = action(
      'ยืนยันยกเลิกการจอง',
      async () => {
        if (pendingMutations.has(panel.id)) return;
        pendingMutations.add(panel.id);
        close.disabled = keep.disabled = true;
        try {
          const { cancelled } = await flightApi('cancel', {
            orderId: order.orderId,
            cancellationId: quote.cancellationId,
            idempotencyKey,
          });
          save({ ...order, cancelled });
        } catch (err) {
          output.textContent = err.message;
        } finally {
          pendingMutations.delete(panel.id);
          close.disabled = keep.disabled = false;
          refreshReceipt(panel);
        }
      },
      'primary',
    );
    content.append(keep, confirm);
  } catch (err) {
    output.textContent = err.message;
  }
}
function refreshReceipt(panel) {
  for (const current of activePanels.values()) {
    if (current.id === panel.id && (current !== panel || current.pendingReceipt)) current.draw();
  }
}
export function renderFlightPanels(container, state, key) {
  if (currentTrip !== key) {
    for (const panel of activePanels.values()) panel.host.replaceChildren();
    activePanels.clear();
    currentTrip = key;
  }
  for (const dir of ['go', 'back']) {
    const route = state.plan?.flags?.transport?.[dir];
    const setupLeg = dir === 'go' ? state.setup?.arrive : state.setup?.depart;
    const option =
      route?.options?.find((row) => row.id === route.chosen) ||
      (typeof route?.chosen === 'object' && route.chosen) ||
      route?.chosenOption ||
      setupLeg?.choice;
    const id = key + '/' + dir;
    const slot = container.querySelector('[data-booking-flight="' + dir + '"]') || container;
    if (route?.order && !orders.has(id)) orders.set(id, route.order);
    const existing = activePanels.get(dir);
    if (existing && existing.offer === option?.offerId && (option?.offerId || orders.has(id))) {
      slot.append(existing.host);
      continue;
    }
    existing?.host.replaceChildren();
    activePanels.delete(dir);
    if (!option?.offerId && !orders.has(id)) continue;
    const host = el('article', null, 'alert flight-booking');
    const panel = { host, id, offer: option?.offerId, members: state.setup?.members || [] };
    activePanels.set(dir, panel);
    slot.append(host);
    function save(order) {
      orders.set(id, order);
      uncertainOrders.delete(id);
      if (activePanels.get(dir) === panel) draw();
    }
    function draw() {
      host.replaceChildren(el('h4', 'จองเที่ยวบิน' + directions[dir]));
      panel.pendingReceipt = pendingMutations.has(id);
      if (panel.pendingReceipt) {
        host.append(el('p', 'กำลังรอผลการยืนยันจากระบบจอง'));
        return;
      }
      if (uncertainOrders.has(id)) {
        host.append(el('p', 'ยังยืนยันผลการจองครั้งก่อนไม่ได้ กรุณาตรวจสอบกับผู้ให้บริการก่อนทำรายการใหม่'));
        return;
      }
      const order = orders.get(id);
      if (order) {
        host.append(
          el(
            'p',
            [
              order.mode === 'test' && 'ทดสอบ',
              order.bookingReference || order.orderId,
              order.type === 'hold' ? 'พักการจอง' : 'จองแล้ว',
              order.payBy && 'ชำระภายใน ' + order.payBy,
              order.cancelled && 'ยกเลิกแล้ว',
            ]
              .filter(Boolean)
              .join(' · '),
          ),
        );
        if (!order.cancelled)
          host.append(action('ตรวจสอบการยกเลิก', () => cancelOrder(panel, order, save, draw)));
      }
      if (option?.offerId && (!order || order.cancelled))
        host.append(
          action(
            'ตรวจราคาและสัมภาระ ' + [option.carrier, option.code].filter(Boolean).join(' '),
            () => openOffer(panel, dir, option, save, draw),
            'primary',
          ),
        );
    }
    panel.draw = draw;
    draw();
  }
}
