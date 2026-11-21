import { action, el } from './integration-ui.js';
import { mediaUrl } from './setup-extras.js';

const baht = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const dates = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const modes = {
  flight: 'เครื่องบิน',
  bus: 'รถบัส',
  train: 'รถไฟ',
  drive: 'รถส่วนตัว',
  undecided: 'ยังไม่ได้เลือกวิธีเดินทาง',
};

function dayLabel(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? dates.format(time) : '';
}
function addDays(date, nights) {
  const time = Date.parse(date) + nights * 86400000;
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : '';
}
function external(url, text) {
  const link = el('a', text);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}
function mapsLink(name, city) {
  const url = new URL('https://www.google.com/maps/search/');
  url.search = new URLSearchParams({ api: '1', query: [name, city].filter(Boolean).join(' ') });
  return external(url, 'ดูแผนที่');
}
function roomLink(name, setup) {
  const url = new URL('https://www.booking.com/searchresults.th.html');
  url.searchParams.set('ss', [name, setup.city].filter(Boolean).join(' '));
  if (setup.startDate && setup.endDate && setup.endDate > setup.startDate) {
    url.searchParams.set('checkin', setup.startDate);
    url.searchParams.set('checkout', setup.endDate);
  }
  if (setup.members?.length) url.searchParams.set('group_adults', String(setup.members.length));
  return external(url, 'เช็กห้องว่างบน Booking.com');
}
function sourceLink(source) {
  const href = mediaUrl(source?.url);
  return href ? external(href, source.title || new URL(href).hostname) : null;
}
function panel(title) {
  const card = el('section', null, 'alert booking-card');
  card.append(el('h3', title));
  return card;
}
function addLodging(container, plan, setup) {
  const flag = plan.flags?.stay || {};
  const booked = flag.booked === true || setup.stay?.mode === 'booked';
  const card = panel(booked ? 'ที่พักที่จองไว้' : 'ที่พักสำหรับทริปนี้');
  container.append(card);
  if (booked) {
    const stays = flag.stays?.length
      ? flag.stays
      : setup.stay?.stays?.length
        ? setup.stay.stays
        : setup.stay?.name
          ? [{ name: setup.stay.name, nights: Math.max(0, plan.days.length - 1) }]
          : [];
    let nextDate = setup.startDate;
    for (const stay of stays) {
      const nights = Number(stay.nights);
      const checkIn = stay.checkIn || nextDate;
      const checkOut = stay.checkOut || addDays(checkIn, nights);
      nextDate = checkOut;
      const row = el('div', null, 'booking-row');
      row.append(el('h4', stay.name));
      const times = [
        Number.isFinite(nights) && nights + ' คืน',
        checkIn && 'เช็กอิน ' + dayLabel(checkIn),
        checkOut && 'เช็กเอาต์ ' + dayLabel(checkOut),
      ];
      row.append(el('p', times.filter(Boolean).join(' · ')), mapsLink(stay.name, setup.city));
      card.append(row);
    }
    if (stays.length > 1) card.append(el('p', 'วันเปลี่ยนที่พัก เริ่มจากที่พักเดิมแล้วเข้าพักแห่งถัดไปตามลำดับ', 'muted'));
    if (!stays.length) card.append(el('p', 'ยังไม่มีข้อมูลที่พักที่จองไว้', 'muted'));
    return;
  }
  if (setup.startDate && setup.startDate === setup.endDate) {
    card.append(el('p', 'ทริปวันเดียว ไม่มีคืนพัก', 'muted'));
    return;
  }
  const area = flag.area || setup.hotelArea;
  if (area) card.append(el('p', 'ย่านที่พัก · ' + area));
  if (flag.why) card.append(el('p', flag.why, 'muted'));
  const examples = flag.examples || flag.options || [];
  for (const stay of examples) {
    const row = el('div', null, 'booking-row');
    const source = stay.src || stay;
    const link = source.checked === 'web' ? sourceLink(source) : null;
    const price = Number(stay.priceNight ?? stay.price);
    row.append(
      el('h4', stay.name),
      el('p', price > 0 ? '฿' + baht.format(price) + ' / ห้อง / คืน' : 'ยังไม่มีราคาต่อคืน'),
    );
    row.append(el('p', link ? 'ราคาจากแหล่งข้อมูลที่ตรวจแล้ว' : 'ข้อมูลประมาณ', 'muted'));
    const links = el('div', null, 'booking-links');
    if (link) links.append(link);
    links.append(mapsLink(stay.name, setup.city), roomLink(stay.name, setup));
    row.append(links);
    card.append(row);
  }
  if (examples.length) card.append(el('p', 'เลือกโรงแรมแล้วจองกับผู้ให้บริการโดยตรง', 'muted'));
  if (!examples.length) {
    card.append(el('p', 'ยังไม่มีตัวอย่างโรงแรมหรือราคาต่อคืนในแผนนี้', 'muted'), roomLink(area || '', setup));
  }
}
function describeOption(option, size) {
  const row = el('div', null, 'booking-row');
  const title = [modes[option.by], option.carrier, option.code].filter(Boolean).join(' · ');
  row.append(el('h4', title || 'ตัวเลือกการเดินทาง'));
  const departure = [option.from, option.dep].filter(Boolean).join(' ');
  const arrival = [option.to, option.arr].filter(Boolean).join(' ');
  row.append(el('p', [departure, arrival].filter(Boolean).join(' → ')));
  const price = Number(option.price);
  const local = option.priceLocal;
  if (price > 0) {
    row.append(
      el(
        'p',
        '฿' +
          baht.format(price) +
          ' / คน' +
          (size > 0 ? ' · รวม ' + size + ' คน ฿' + baht.format(price * size) : ''),
      ),
    );
  } else if (local?.amount > 0 && local.currency) {
    const display = (amount) =>
      Number(amount).toLocaleString('th-TH', { maximumFractionDigits: 2 }) + ' ' + local.currency;
    row.append(
      el(
        'p',
        display(local.amount) +
          ' / คน' +
          (size > 0 ? ' · รวม ' + size + ' คน ' + display(local.amount * size) : ''),
      ),
    );
  } else row.append(el('p', 'ยังไม่มีข้อมูลค่าโดยสาร', 'muted'));
  if (option.bag) row.append(el('p', 'สัมภาระ · ' + option.bag, 'muted'));
  const link = option.checked === 'web' ? sourceLink(option.src) : null;
  const evidence =
    option.checked === 'live'
      ? option.test
        ? 'ข้อเสนอทดสอบจาก Duffel'
        : 'ข้อเสนอจากสายการบินผ่าน Duffel'
      : link
        ? 'ตรวจจากเว็บไซต์'
        : 'ข้อมูลประมาณ';
  const info = el('p', evidence, 'muted');
  if (link) info.append(' · ', link);
  row.append(info);
  if (option.recommended || option.why)
    row.append(
      el('p', [option.recommended && 'Bop แนะนำ', option.why].filter(Boolean).join(' · '), 'booking-reason'),
    );
  return row;
}
function addDirection(selected, fallback, plan, setup, dir, { adjust, run }) {
  const outbound = dir === 'go';
  const label = outbound ? 'ขาไป' : 'ขากลับ';
  const leg = (outbound ? setup.arrive : setup.depart) || {};
  const route = plan.flags?.transport?.[dir] || {};
  const options = route.options || [];
  const chosen =
    options.find((option) => option.id === route.chosen) ||
    (typeof route.chosen === 'object' && route.chosen) ||
    route.chosenOption ||
    leg.choice;
  const card = el('div', null, 'booking-direction');
  card.append(el('h4', 'การเดินทาง' + label));
  const date = dayLabel(outbound ? setup.startDate : setup.endDate);
  if (date) card.append(el('p', date, 'muted'));
  if (chosen) {
    card.append(el('span', 'เลือกไว้ในแผน', 'booking-tag'), describeOption(chosen, setup.members?.length || 0));
  } else {
    const from = outbound ? leg.from : setup.city;
    const to = outbound ? setup.city : leg.to;
    const row = el('div', null, 'booking-row');
    row.append(el('h4', modes[leg.by] || modes.undecided));
    const routeText = [from || 'ยังไม่ระบุต้นทาง', to || 'ยังไม่ระบุปลายทาง'].join(' → ');
    row.append(el('p', routeText + (leg.time ? ' · ' + (outbound ? 'ถึง ' : 'ออก ') + leg.time : '')));
    if (leg.by !== 'drive') row.append(el('p', 'ยังไม่มีค่าโดยสารที่เลือกไว้', 'muted'));
    const suggestion = outbound ? plan.flags?.arrivalSuggested : plan.flags?.departureSuggested;
    if (leg.by === 'undecided' && suggestion?.by && suggestion.by !== 'none')
      row.append(
        el(
          'p',
          ['Bop แนะนำ ' + (modes[suggestion.by] || suggestion.by), suggestion.why]
            .filter(Boolean)
            .join(' · '),
          'booking-reason',
        ),
      );
    card.append(row);
  }
  const flight = el('div');
  flight.dataset.bookingFlight = dir;
  card.append(flight);
  const alternatives = options.filter(
    (option) => option !== chosen && (!chosen?.id || chosen.id !== option.id),
  );
  if (alternatives.length) {
    const details = el('details', null, 'booking-options');
    details.append(el('summary', 'เปรียบเทียบตัวเลือกอื่น (' + alternatives.length + ')'));
    for (const option of alternatives) {
      const row = describeOption(option, setup.members?.length || 0);
      const name = [option.carrier, option.code].filter(Boolean).join(' ');
      const service = option.by === 'flight' ? 'เที่ยวบิน' : modes[option.by] || 'การเดินทาง';
      const command =
        'เปลี่ยน' +
        service +
        label +
        'เป็น ' +
        [name, option.dep && 'ออก ' + option.dep, option.arr && 'ถึง ' + option.arr].filter(Boolean).join(' ');
      row.append(
        action('เปลี่ยนเป็น ' + name, () =>
          run(() => adjust(command, outbound ? 0 : Math.max(0, plan.days.length - 1))),
        ),
      );
      details.append(row);
    }
    card.append(details);
  }
  (chosen ? selected : fallback).append(card);
}
export function reservationStatus(state, stop) {
  return state.bookings?.[stop.id]?.state || (stop.res?.done ? 'done' : 'todo');
}
export function setReservationDone(state, stop, done) {
  state.bookings ??= {};
  if (done) {
    const day = state.plan?.days?.find((entry) => entry?.stops?.some((item) => item.id === stop.id));
    state.bookings[stop.id] = {
      state: 'done',
      name: stop.name,
      time: stop.start,
      day: day?.date,
      phone: stop.res?.phone || stop.phone,
      ...(stop.res?.script || state.bookings[stop.id]?.script
        ? { script: stop.res?.script || state.bookings[stop.id].script }
        : {}),
    };
  } else {
    delete state.bookings[stop.id];
    if (stop.res?.done) stop.res = { ...stop.res, done: false, todo: true };
  }
}
function phoneLink(row, number) {
  if (!number) return;
  const raw = String(number).trim();
  const normalized = raw.replace(/[\s().-]/g, '');
  if (/^\+?\d{4,16}$/.test(normalized)) {
    const link = el('a', 'โทร ' + raw);
    link.href = 'tel:' + normalized;
    row.append(link);
  } else row.append(el('p', 'โทรศัพท์ · ' + raw));
}
export function reservationCallScript(state, stop, day) {
  const group = state.setup?.members || [];
  const organizer = group.find((person) => person.role === 'organizer') || group[0];
  const party = group.length ? 'สำหรับ ' + group.length + ' คน' : 'สำหรับกลุ่ม';
  const when = [dayLabel(day?.date), stop.start && 'เวลา ' + stop.start + ' น.'].filter(Boolean).join(' ');
  const booking = state.bookings?.[stop.id];
  const owner = organizer?.name ? ' ผู้จองชื่อ' + organizer.name : '';
  if (booking?.state === 'move') {
    const previous = [dayLabel(booking.day || day?.date), booking.time].filter(Boolean).join(' ');
    return (
      'สวัสดีค่ะ/ครับ ขอสอบถามเรื่องการจอง' +
      party +
      owner +
      ' เดิมนัดไว้ ' +
      previous +
      ' ขอเลื่อนไปเป็น ' +
      when +
      ' ยังมีที่ว่างไหมคะ/ครับ'
    );
  }
  if (stop.res?.script || booking?.script) return stop.res?.script || booking.script;
  const dietary = [...new Set(group.map((member) => member.avoid).filter(Boolean))];
  const preferences = dietary.length
    ? ' ในกลุ่มมีคนแพ้หรือไม่ทาน ' + dietary.join(', ') + ' ทางร้านจัดให้ได้ไหมคะ/ครับ'
    : '';
  return ['สวัสดีค่ะ/ครับ ขอจอง' + party, when + owner + 'ค่ะ/ครับ', stop.res?.ask || '', preferences]
    .filter(Boolean)
    .join(' ');
}
function callText(row, script) {
  const text = el('blockquote', script, 'booking-call-script');
  const status = el('span', '', 'muted');
  status.setAttribute('role', 'status');
  row.append(
    text,
    action('คัดลอกบทพูด', async () => {
      try {
        await navigator.clipboard.writeText(script);
        status.textContent = 'คัดลอกแล้ว';
      } catch {
        const range = document.createRange();
        range.selectNodeContents(text);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        status.textContent = 'เลือกบทพูดแล้ว กดคัดลอกบนอุปกรณ์';
      }
    }),
    status,
  );
}
function sampleLedger(container, state, setup, rerender) {
  const card = panel('การเดินทางและที่พัก');
  card.append(el('p', 'รายการจำลองสำหรับลองจัดการการจอง · ไม่มีการชำระเงินจริง', 'muted'));
  const size = setup.members?.length || 1;
  const days = state.plan.days.filter(Boolean),
    nights = Math.max(0, days.length - 1);
  const rooms = Math.ceil(size / 2);
  const items = [];
  if (setup.arrive?.by === 'flight')
    items.push({
      title: 'เที่ยวบินขาไป ' + [setup.arrive.from, setup.cityAirport || setup.city].filter(Boolean).join(' → '),
      when: [dayLabel(setup.startDate), 'ถึง ' + setup.arrive.time, size + ' ที่นั่ง'].join(' · '),
      cost: 1240 * size,
    });
  if (nights)
    items.push({
      title: 'ห้องพักใน' + setup.city,
      when: rooms + ' ห้อง · ' + nights + ' คืน',
      cost: 990 * rooms * nights,
    });
  const pickup = days
    .flatMap((day) => day.stops || [])
    .find((stop) => stop.leg?.cost > 0 && ['car', 'red', 'van'].includes(stop.leg.mode));
  if (pickup)
    items.push({
      title: 'รถรับส่งไป' + pickup.name,
      when: dayLabel(days.find((day) => day.stops.includes(pickup))?.date) + ' · ถึง ' + pickup.start,
      cost: pickup.leg.cost * size,
    });
  const ticketDay = days.find((day) =>
    day.stops?.some((stop) => (stop.kind || stop.k) === 'sight' && stop.cost > 0),
  );
  const visit = ticketDay?.stops.find((stop) => (stop.kind || stop.k) === 'sight' && stop.cost > 0);
  if (visit)
    items.push({
      title: 'บัตรเข้าชม ' + visit.name,
      when: dayLabel(ticketDay.date) + ' · ' + visit.start + ' · ' + size + ' คน',
      cost: visit.cost * size,
      hold: visit.id + '/' + visit.name,
    });
  if (setup.depart?.by === 'flight')
    items.push({
      title: 'เที่ยวบินขากลับ ' + [setup.cityAirport || setup.city, setup.depart.to].filter(Boolean).join(' → '),
      when: [dayLabel(setup.endDate), 'ออก ' + setup.depart.time, size + ' ที่นั่ง'].join(' · '),
      cost: 1190 * size,
    });
  let sum = 0;
  for (const item of items) {
    sum += item.cost;
    const row = el('div', null, 'booking-row');
    const head = el('div', null, 'booking-item-head');
    head.append(el('h4', item.title), el('strong', '฿' + baht.format(item.cost)));
    row.append(head, el('p', item.when, 'muted'));
    if (item.hold && !state.sampleApprovals?.[item.hold]) {
      row.append(
        el('p', 'ถือที่ไว้ · รอผู้จัดทริปอนุมัติ'),
        action('อนุมัติรายการจำลอง ฿' + baht.format(item.cost), () => {
          state.sampleApprovals ??= {};
          state.sampleApprovals[item.hold] = true;
          rerender();
        }),
      );
    } else row.append(el('p', item.hold ? 'อนุมัติแล้วในทริปตัวอย่าง' : 'ยืนยันแล้วในทริปตัวอย่าง', 'booking-reason'));
    card.append(row);
  }
  card.append(el('strong', 'รวมทั้งกลุ่ม ฿' + baht.format(sum), 'booking-total'));
  container.append(card);
}

function addCalls(container, state, { adjust, rerender, run }) {
  const card = panel('ร้านอาหารและงานโทรจอง');
  const members = state.setup?.members || [];
  const organizer = members.find((item) => item.role === 'organizer') || members[0];
  card.append(el('p', organizer?.name ? 'ผู้ติดต่อร้าน · ' + organizer.name : 'ผู้จัดทริปติดต่อร้านโดยตรง', 'muted'));
  let pending = 0;
  for (const task of state.cancellations || []) {
    if (task.handled !== true) pending++;
    const row = el('div', null, 'booking-row');
    row.append(
      el('h4', task.name),
      el(
        'p',
        [task.handled ? 'ติดต่อยกเลิกแล้ว' : 'ติดต่อเพื่อยกเลิก', dayLabel(task.day) || task.day, task.time]
          .filter(Boolean)
          .join(' · '),
      ),
    );
    phoneLink(row, task.phone);
    row.append(
      action(task.handled ? 'กลับไปรอติดต่อ' : 'ติดต่อยกเลิกแล้ว', () => {
        task.handled = !task.handled;
        rerender();
      }),
    );
    card.append(row);
  }
  for (const [index, day] of state.plan.days.entries()) {
    for (const stop of day?.stops || []) {
      const record = state.bookings?.[stop.id];
      if (!stop.res?.todo && !stop.res?.done && !record) continue;
      const status = reservationStatus(state, stop);
      if (status !== 'done') pending++;
      const row = el('div', null, 'booking-row');
      const previous = [record?.day && record.day !== day.date ? dayLabel(record.day) : '', record?.time]
        .filter(Boolean)
        .join(' ');
      const schedule =
        status === 'move' ? 'เลื่อนจาก ' + previous + ' เป็น ' + (record.next || stop.start) : stop.start;
      row.append(
        el('h4', stop.name),
        el(
          'p',
          [
            status === 'move' ? 'ต้องโทรเลื่อน' : status === 'done' ? 'ยืนยันการจองแล้ว' : 'รอติดต่อ',
            dayLabel(day.date),
            schedule,
          ]
            .filter(Boolean)
            .join(' · '),
        ),
      );
      if (stop.res?.note) row.append(el('p', stop.res.note, 'muted'));
      if (stop.res?.by) row.append(el('p', 'ติดต่อภายใน ' + stop.res.by));
      const phone = stop.res?.phone || stop.phone || record?.phone;
      if (phone) phoneLink(row, phone);
      else if (status !== 'done') {
        const missing = el('p', 'ยังไม่มีเบอร์โทรที่ยืนยันแล้ว · ', 'muted');
        missing.append(mapsLink(stop.name, state.setup?.city));
        row.append(missing);
      }
      if (status !== 'done') callText(row, reservationCallScript(state, stop, day));
      const controls = el('div', null, 'booking-links');
      const confirm =
        status === 'done' ? 'กลับไปรอติดต่อ' : status === 'move' ? 'ยืนยันว่าเลื่อนแล้ว' : 'ทำเครื่องหมายว่าจองแล้ว';
      controls.append(
        action(confirm, () => {
          setReservationDone(state, stop, status !== 'done');
          rerender();
        }),
      );
      controls.append(
        action('สถานที่เต็ม · หาแห่งใหม่', () =>
          run(() => adjust('ร้าน ' + stop.name + ' เต็ม ช่วยหาที่อื่นแทน', index)),
        ),
      );
      row.append(controls);
      card.append(row);
    }
  }
  if (card.childElementCount === 2) card.append(el('p', 'ยังไม่มีรายการที่ต้องติดต่อ', 'muted'));
  container.append(card);
  return pending;
}
export function renderBookingTasks(container, state, actions) {
  container.replaceChildren();
  if (!state.plan) return 0;
  const setup = state.setup || state.plan.setup || {};
  const line = el('div');
  line.dataset.bookingLine = '';
  container.append(line);
  const selected = panel('ตัวเลือกเดินทางไป–กลับ');
  const fallback = panel('การเดินทางของกลุ่ม');
  for (const dir of ['go', 'back']) addDirection(selected, fallback, state.plan, setup, dir, actions);
  if (selected.childElementCount > 1) container.append(selected);
  if (!state.sample || state.plan.flags?.stay?.examples?.length || setup.stay?.mode === 'booked')
    addLodging(container, state.plan, setup);
  const pending = addCalls(container, state, actions);
  if (state.sample) sampleLedger(container, state, setup, actions.rerender);
  else {
    if (setup.hasCar) {
      const car = el('div', null, 'booking-row');
      car.append(el('h4', 'รถส่วนตัวระหว่างทริป'), el('p', 'กลุ่มเตรียมรถเอง ไม่มีรายการจองรถ', 'muted'));
      fallback.append(car);
    }
    if (fallback.childElementCount > 1) container.append(fallback);
  }
  return pending;
}
