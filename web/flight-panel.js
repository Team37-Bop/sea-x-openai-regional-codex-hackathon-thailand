import { el, action, label, message } from './integration-ui.js';

const orders = new Map();
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
function dialog(title) {
  const shell = el('dialog');
  const content = el('div');
  const close = action('ปิด', () => shell.close());
  shell.append(el('h2', title), content, close);
  shell.addEventListener(
    'close',
    () => {
      shell.remove();
    },
    { once: true },
  );
  document.body.append(shell);
  shell.showModal();
  return { shell, content, close };
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
function passengerForm(form, passenger, i) {
  const group = el('fieldset');
  group.append(el('legend', 'ผู้โดยสารคนที่ ' + (i + 1)));
  const fields = {
    title: selector([
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
      ['m', 'ชาย'],
      ['f', 'หญิง'],
    ]),
    email: input('email', 254),
    phone_number: input('tel', 24),
  };
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
  const { content, shell, close } = page;
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
  const form = el('form');
  const gather = offer.passengers.map((p, i) => passengerForm(form, p, i));
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
    const approvedTotal = {
      amount: Number(
        (
          offer.total.amount +
          choices.reduce((sum, x) => sum + x.service.price.amount * Number(x.quantity.value), 0)
        ).toFixed(4),
      ),
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
        back.disabled = close.disabled = true;
        shell.oncancel = (event) => event.preventDefault();
        let mayEdit = true;
        try {
          const { order } = await flightApi('order', operation);
          form.reset();
          content.replaceChildren();
          save(order);
          shell.close();
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
            confirm.hidden = true;
            output.textContent += ' · กรุณาตรวจสอบผลการจองกับผู้ให้บริการก่อนทำรายการใหม่';
          }
        } finally {
          close.disabled = false;
          back.disabled = !mayEdit;
          shell.oncancel = null;
        }
      },
      'primary',
    );
    reviewArea.append(back, confirm);
    form.hidden = true;
    content.append(reviewArea);
  });
}
async function openOffer(dir, option, save) {
  const page = dialog('ตรวจสอบเที่ยวบิน' + directions[dir]);
  page.content.append(el('p', 'กำลังตรวจราคาล่าสุด'));
  try {
    const details = await flightApi('offer', { offerId: option.offerId });
    if (page.shell.open) showReview(page, details, save);
  } catch (err) {
    page.content.replaceChildren(el('p', err.message));
  }
}
async function cancelOrder(order, save) {
  const { shell, content, close } = dialog('ตรวจสอบยอดคืนก่อนยกเลิก');
  const output = message(content);
  try {
    const { quote } = await flightApi('cancel', { orderId: order.orderId });
    if (!shell.open) return;
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
    const keep = action('เก็บการจองไว้', () => shell.close());
    const confirm = action(
      'ยืนยันยกเลิกการจอง',
      async () => {
        close.disabled = keep.disabled = true;
        shell.oncancel = (e) => e.preventDefault();
        try {
          const { cancelled } = await flightApi('cancel', {
            orderId: order.orderId,
            cancellationId: quote.cancellationId,
            idempotencyKey,
          });
          save({ ...order, cancelled });
          shell.close();
        } catch (err) {
          output.textContent = err.message;
        } finally {
          close.disabled = keep.disabled = false;
          shell.oncancel = null;
        }
      },
      'primary',
    );
    content.append(keep, confirm);
  } catch (err) {
    output.textContent = err.message;
  }
}
export function renderFlightPanels(container, state, key) {
  for (const dir of ['go', 'back']) {
    const route = state.plan?.flags?.transport?.[dir];
    const option =
      typeof route?.chosen === 'string' ? route.options?.find((o) => o.id === route.chosen) : route?.chosen;
    const id = key + '/' + dir;
    if (!option?.offerId && !orders.has(id)) continue;
    const host = el('article', null, 'alert');
    container.append(host);
    function save(order) {
      orders.set(id, order);
      draw();
    }
    function draw() {
      host.replaceChildren(el('h3', 'จองเที่ยวบิน' + directions[dir]));
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
        if (!order.cancelled) host.append(action('ตรวจสอบการยกเลิก', () => cancelOrder(order, save)));
      }
      if (option?.offerId && (!order || order.cancelled))
        host.append(
          action(
            'ตรวจราคาและสัมภาระ ' + [option.carrier, option.code].filter(Boolean).join(' '),
            () => openOffer(dir, option, save),
            'primary',
          ),
        );
    }
    draw();
  }
}
