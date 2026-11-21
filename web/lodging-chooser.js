import { el } from './integration-ui.js';
import { mediaUrl } from './setup-extras.js';
import { splitStopNote } from './stop-note.js';

const amounts = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const dates = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function stayDates(setup) {
  const start = Date.parse(setup.startDate), end = Date.parse(setup.endDate);
  return Number.isFinite(start) && Number.isFinite(end) ? dates.formatRange(start, end) : '';
}

export function createLodgingChooser(dialog, { request, apply, changed }) {
  const options = dialog.querySelector('[data-options]');
  const message = dialog.querySelector('[data-message]');
  const search = dialog.querySelector('[data-search]');
  const confirm = dialog.querySelector('[data-select]');
  const recommend = dialog.querySelector('[data-recommend]');
  let session;

  function setStatus(text, pending = false) {
    message.toggleAttribute('data-pending', pending);
    message.textContent = text;
  }
  function actions() {
    const waiting = session.phase === 'search' || session.phase === 'apply';
    options.disabled = waiting;
    recommend.disabled = waiting || !session.options.length;
    confirm.disabled = recommend.disabled || !session.selected;
    search.hidden = !['empty', 'error'].includes(session.phase);
    changed();
  }
  function showOptions() {
    options.querySelectorAll('.lodging-option').forEach(row => row.remove());
    for (const hotel of session.options) {
      const row = el('div', null, 'lodging-option');
      const label = el('label');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'lodging-option';
      radio.value = hotel.id;
      radio.checked = hotel.id === session.selected;
      radio.onchange = () => {
        session.selected = hotel.id;
        actions();
      };
      label.append(radio, el('strong', hotel.name));
      if (hotel.id === session.recommendedId) label.append(el('small', 'Bop แนะนำ'));
      row.append(label);
      const address = (hotel.query || '').split(',').slice(1).join(',').trim();
      if (address) row.append(el('p', address));
      const why = splitStopNote(hotel.why).text
        .replace(/^แนะนำ(?:เป็น)?อันดับแรก\s*[:：]\s*/u, '')
        .replace(/\s*\((?:[a-z0-9-]+\.)+[a-z]{2,}\)\s*$/i, '')
        .replace(/\s*ไม่พบราคาสำหรับวันที่\s+[\d๐-๙].*$/u, '').trim();
      if (why) row.append(el('p', why));
      row.append(el('p', hotel.priceNight > 0
        ? 'ประมาณ ฿' + amounts.format(hotel.priceNight) + ' / ห้อง / คืน'
        : 'ยังไม่มีราคาสำหรับวันเข้าพัก'));
      const source = hotel.src || hotel;
      const url = source.checked === 'web' && mediaUrl(source.url);
      if (url) {
        const link = el('a', 'ข้อมูลโรงแรม · ' + new URL(url).hostname.replace(/^www\./, ''));
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        row.append(link);
      }
      options.append(row);
    }
    options.hidden = !session.options.length;
  }
  async function perform(action) {
    const current = session;
    if (!current || current.controller) return;
    const controller = new AbortController();
    current.controller = controller;
    current.phase = action === 'options' ? 'search' : 'apply';
    setStatus(action === 'options' ? 'Bop กำลังค้นหาที่พัก…' : 'กำลังปรับจุดพักและเส้นทางในแผน…', true);
    actions();
    try {
      const result = await request(current.plan, {
        action, ...(action === 'choose' ? { optionId: current.selected }
          : action === 'recommend' && current.recommendedId ? { optionId: current.recommendedId } : {}),
      }, current, controller.signal, text => {
        if (session === current && !controller.signal.aborted) setStatus(text, true);
      });
      if (current !== session || controller.signal.aborted) return;
      if (action === 'options') {
        current.options = (result.options || []).filter(item => item?.id && item.name);
        current.recommendedId = result.recommendedId;
        current.offerRef = result.offerRef;
        if (!current.options.some(item => item.id === current.selected)) current.selected = null;
        current.phase = current.options.length ? 'ready' : 'empty';
        contextLabel(current.plan, result.area);
        showOptions();
        setStatus(current.options.length ? '' : 'ยังไม่พบโรงแรมที่ยืนยันได้ในย่านนี้');
      } else {
        if (!result.plan?.days?.length || !['chosen', 'recommended'].includes(result.plan.flags?.stay?.selection))
          throw Error('ยังไม่ได้รับแผนที่ยืนยันที่พัก');
        reset();
        apply(current.plan, result);
      }
    } catch (error) {
      if (current !== session || controller.signal.aborted) return;
      current.phase = 'error';
      setStatus(error.message || 'ค้นหาที่พักไม่สำเร็จ ลองอีกครั้งได้');
    } finally {
      if (session === current) {
        current.controller = null;
        actions();
      }
    }
  }
  function contextLabel(plan, area) {
    const city = plan.city || plan.setup.city;
    dialog.querySelector('#lodging-context').textContent =
      [city, area && area !== city ? area : '', stayDates(plan.setup), (plan.days.length - 1) + ' คืน'].filter(Boolean).join(' · ');
  }
  function open(plan) {
    if (session?.plan !== plan) {
      reset();
      session = { plan, options: [], selected: null, phase: 'idle' };
      contextLabel(plan, plan.flags?.stay?.area);
      showOptions();
      setStatus('');
    }
    if (!dialog.open) {
      dialog.showModal();
      dialog.querySelector('h2').focus({ preventScroll: true });
    }
    if (session.phase === 'idle') void perform('options');
    else actions();
  }
  function reset() {
    session?.controller?.abort();
    session = null;
    if (dialog.open) dialog.close();
  }
  dialog.querySelector('[data-dismiss]').onclick = () => dialog.close();
  dialog.addEventListener('close', changed);
  search.onclick = () => perform('options');
  recommend.onclick = () => perform('recommend');
  confirm.onclick = () => perform('choose');
  return { open, reset };
}
