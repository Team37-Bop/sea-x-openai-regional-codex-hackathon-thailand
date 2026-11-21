// Deterministic stand-in for the Claude layer, for testing the full pipeline without an API key.
// Enabled only with BOP_FAKE_LLM=1. Output mimics what the real model returns (same JSON schemas).
import { BASE, CATALOG, dayStays } from '../src/plan.js';
import { danangDays, DANANG_CANDIDATES } from './fixtures/danang.mjs';
const isDanang = c => /ดานัง|da ?nang|đà ?nẵng/i.test(c || '');

const catIds = new Set(CATALOG.map(c => c.id));
// A few stops go through Photon instead of the catalog, to exercise geocoding.
const GEOCODE = { phrasingh: 'Wat Phra Singh', warorot: 'Warorot Market', jingjai: 'Jing Jai Market', bankangwat: 'Baan Kang Wat' };

export function toSpec(st, over = {}) {
  const geo = GEOCODE[st.id];
  return Object.assign({
    id: st.id, n: st.n, k: st.k, t0: st.t0, t1: st.t1,
    query: geo || st.n, catalog: !geo && catIds.has(st.id) ? st.id : '',
    lat: st.ll[0], lng: st.ll[1], cost: st.cost || 0, walk: st.walk || 0, open: st.open || '',
    meal: st.meal || '', veg: !!st.veg, diet: !!st.diet, walkin: !!st.walkin, outdoor: !!st.outdoor, dress: !!st.dress,
    star: st.star || '', note: st.note || '', reserve: !!st.res, resAsk: st.res ? st.res.ask : '', resBy: st.res ? st.res.by : '',
    mode: st.leg ? st.leg.m : 'none', legCost: st.leg ? st.leg.cost : -1, legWhy: st.leg ? st.leg.why || '' : '',
    closedDays: (st.days && st.days.closed) || [], onlyDays: (st.days && st.days.only) || [], closures: st.closures || [],
  }, over);
}
const cat = id => CATALOG.find(c => c.id === id);
// Booked stays: name the hotel stops the way the real model is told to (TripSetup.stayPlan): the day's first hotel stop is
// the hotel it starts from, later ones the hotel it ends at. Coordinates stay the sample's, so the server's pinning runs.
function bookedNames(stops, setup, i) {
  const ds = dayStays(setup)[i]; if (!ds || (!ds.start && !ds.end)) return stops;
  let seen = 0;
  return stops.map(sp => {
    if (sp.k !== 'stay') return sp;
    const b = (seen++ === 0 && i > 0 ? ds.start : ds.end) || ds.start || ds.end;
    return { ...sp, n: b.name, query: b.name, catalog: '', ...(ds.move && seen === 1 && i > 0 ? { note: `เช็กเอาต์ ขนกระเป๋าไป${ds.end.name}` } : {}) };
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function createFakeLlm() {
  return {
    async design({ setup, onDay }) {
      if (isDanang(setup.city)) {
        const days = danangDays(setup);
        for (let i = 1; i <= days.length; i++) { onDay && onDay(i); await sleep(30); }
        return { json: { summary: 'แผนทดสอบ (fake) ดานัง: บานาฮิลล์ ฮอยอัน เซินจ่า · คิดเรท 1,000 ดอง ≈ 1.4 บาท', arrival: { by: 'none', why: '' }, days }, messages: [] };
      }
      const wisher = setup.members.find(m => m.wants && m.wants.length);
      const days = BASE.days.slice(0, setup.days).map((d, i) => ({ stops: bookedNames(d.stops.map(st => {
        const o = {};
        if (st.star) o.star = wisher ? wisher.id : '';
        if (st.id === 'brunch') o.veg = false; // deliberate miss so the repair round runs
        return toSpec(st, o);
      }), setup, i) }));
      for (let i = 1; i <= days.length; i++) { onDay && onDay(i); await sleep(30); }
      return { json: { summary: 'แผนทดสอบ (fake LLM): เมืองเก่า ดอยปุย แม่แตง และถนนคนเดิน', days }, messages: [] };
    },
    async replan({ command }) {
      if (/เที่ยวบิน|flight/i.test(command)) {
        return { messages: [], json: { summary: 'เปลี่ยนเที่ยวบินขาไป', day: 0, needs_vote: false, vote_reason: '',
          transport: { dir: 'go', by: 'flight', carrier: 'Nok Air', code: 'DD8302', from: 'DMK', to: 'CNX', dep: '08:00', arr: '09:15' },
          options: [{ key: 'A', title: 'เปลี่ยนเป็น DD8302', head: 'ถึง 09:15 เหมือนเดิม', line: 'Bop: เปลี่ยนเที่ยวบินขาไปเป็น Nok Air DD8302', edits: [] }] } };
      }
      if (/ฝน|rain/i.test(command)) {
        const half = { op: 'replace', id: 'doipui', day: 0, after: '', stop: toSpec(BASE.days[1].stops[1], { lat: 0, lng: 0, catalog: '', legCost: 250, legWhy: 'เหมารถตู้ครึ่งวัน ฿1,000 หาร 4' }) };
        const drop = [{ op: 'remove', id: 'lunch_rt', day: 1, after: '', stop: null }, { op: 'remove', id: 'buatong', day: 1, after: '', stop: null }];
        return { messages: [], json: { summary: 'ฝนหนักที่แม่แตงช่วงบ่าย ย้ายกิจกรรมบ่ายเข้าในร่ม', day: 1, needs_vote: true,
          vote_reason: 'A ตรงใจกลุ่มกว่าแต่เกินงบของฝน B อยู่ในงบทุกคน',
          options: [
            { key: 'A', title: 'A · คลาสทำอาหารไทยในร่ม', head: 'ทำและกินมื้อกลางวันมังสวิรัติเอง', line: 'Bop: ฝนหนักที่แม่แตง\nเปลี่ยนบ่ายนี้เป็นคลาสทำอาหารไทยในร่ม', edits: [...drop, half,
              { op: 'insert', id: '', day: 1, after: 'nimman', stop: toSpec({ ...cat('class'), t0: '11:55', t1: '15:00', leg: { m: 'van', cost: 0, why: 'รถตู้ส่งที่คลาส' } }) }] },
            { key: 'B', title: 'B · MAIIAM พิพิธภัณฑ์ศิลปะร่วมสมัย', head: 'กินกลางวันที่นิมมาน แล้วดูงานศิลปะในร่ม', line: 'Bop: ฝนหนักที่แม่แตง\nกินกลางวันที่นิมมาน แล้วไป MAIIAM', edits: [...drop, half,
              { op: 'insert', id: '', day: 1, after: 'nimman', stop: toSpec({ ...cat('lunch_nm'), t0: '11:40', t1: '12:30', leg: { m: 'walk', cost: 0 } }) },
              { op: 'insert', id: '', day: 1, after: 'lunch_nm', stop: toSpec({ ...cat('maiiam'), t0: '13:05', t1: '15:00', leg: { m: 'car', cost: 70 } }, { catalog: '', query: 'MAIIAM Contemporary Art Museum' }) }] },
          ] } };
      }
      return { messages: [], json: { summary: 'ตัดน้ำตกบัวตองออก', day: 1, needs_vote: false, vote_reason: '', options: [
        { key: 'A', title: 'ตัดน้ำตกบัวตองออก', head: 'บ่ายวันเสาร์ว่างขึ้น', line: 'Bop: ตัดน้ำตกบัวตองออกแล้ว', edits: [{ op: 'remove', id: 'buatong', day: 1, after: '', stop: null }] }] } };
    },
    async repair({ report }) {
      const fixes = [];
      const bid = (/\b((?:d\d+_)?brunch)\b/.exec(report) || [])[1];
      if (bid && /มังสวิรัติ/.test(report))
        fixes.push({ key: 'A', edits: [{ op: 'replace', id: bid, day: 1, after: '', stop: toSpec(BASE.days[1].stops[3], { lat: 0, lng: 0, catalog: '', veg: true }) }] });
      return { json: { note: 'fake repair', fixes } };
    },
    async transport({ prompt, onStep }) {
      const back = /ขากลับ/.test(prompt);
      onStep && onStep(`ค้นเว็บ: “${back ? 'CNX DMK' : 'DMK CNX'} flights”`);
      const o = (carrier, code, dep, arr, price, rec) => ({ by: 'flight', carrier, code, from: back ? 'CNX' : 'DMK', to: back ? 'DMK' : 'CNX', dep, arr, price, bag: 'carry-on 7 กก.',
        srcUrl: 'https://example.com/made-up', srcTitle: 'made up', checked: 'web', recommended: rec, why: rec ? 'ถึงทันมื้อเที่ยง (ราคาประมาณจากเว็บ)' : '' });
      return { json: { options: back ? [o('Thai AirAsia', 'FD3442', '21:15', '22:25', 1290, true), o('Nok Air', 'DD8317', '19:55', '21:05', 1190, false)]
        : [o('Thai AirAsia', 'FD3433', '08:00', '09:15', 1190, true), o('Nok Air', 'DD8300', '07:00', '08:10', 1090, false), o('Thai Lion Air', 'SL530', '10:10', '11:20', 1350, false)] }, seenUrls: new Map() };
    },
    async skeleton({ prompt }) {
      const n = +(/days ต้องมี (\d+)/.exec(prompt) || [])[1] || 3;
      await sleep(50);
      return { json: { summary: 'แผนทดสอบ (fake, แบ่งรายวัน) ดานัง · คิดเรท 1,000 ดอง ≈ 1.4 บาท', arrival: { by: 'none', why: '' },
        hotel: { name: 'โรงแรมเมืองถั่นลักชัวรี ดานัง', query: 'Muong Thanh Luxury Da Nang', lat: 16.0646, lng: 108.2466, costPerPerson: 2400 },
        days: Array.from({ length: n }, (_, i) => ({ theme: ['มาถึง เมืองเก่า', 'บานาฮิลล์', 'ฮอยอัน', 'เซินจ่า ทะเล'][i % 4], area: 'ดานัง', wishes: i ? [] : ['m1'], meals: 'กลางวัน เย็น', places: [] })) } };
    },
    async designDay({ prompt, onStep }) {
      const i = +(/เฉพาะวันที่ (\d+) จาก (\d+)/.exec(prompt) || [])[1] - 1, n = +(/เฉพาะวันที่ \d+ จาก (\d+)/.exec(prompt) || [])[1];
      const setup = JSON.parse(prompt.slice(prompt.indexOf('TripSetup:') + 10));
      onStep && onStep(`ค้นเว็บ: “fake day ${i + 1}”`);
      await sleep(200 + 100 * i);
      if (!isDanang(setup.city)) {
        const wisher = setup.members.find(m => m.wants && m.wants.length);
        const d = BASE.days[i % BASE.days.length];
        return { json: { stops: bookedNames(d.stops.map(st => toSpec(st, { id: `d${i + 1}_${st.id}`, ...(st.star ? { star: wisher ? wisher.id : '' } : {}), ...(st.id === 'brunch' ? { veg: false } : {}) })), setup, i) }, seenUrls: new Map() };
      }
      return { json: { stops: danangDays({ ...setup, days: n })[i].stops }, seenUrls: new Map() };
    },
    async candidates({ onStep }) {
      onStep && onStep('ค้นเว็บ: “Da Nang best restaurants Michelin 2025”');
      await sleep(30);
      return { json: JSON.parse(JSON.stringify(DANANG_CANDIDATES)), seenUrls: new Map() };
    },
    async research({ stop, onStep }) {
      onStep && onStep(`ค้นเว็บ: “${stop.n} เมนู ราคา”`);
      await sleep(30);
      return { json: { summary: `${stop.n} (ข้อมูลทดสอบ)`, details: { what: `${stop.n} (ข้อมูลทดสอบ)`, highlights: ['ไฮไลต์ทดสอบ 1', 'ไฮไลต์ทดสอบ 2'], price: '', hours: '', rating: '', booking: '', address: '' }, dishes: [{ name: 'ข้าวซอยไก่', price: 60, veg: false, why: 'จานขึ้นชื่อ' }, { name: 'ข้าวซอยเห็ด', price: 60, veg: true, why: 'สำหรับคนกินเจ' }, { name: 'น้ำมะพร้าว', price: null, veg: true }],
        priceRange: '฿60–120 ต่อคน', hours: '', phone: '', tips: ['ไปก่อนเที่ยงคิวสั้นกว่า'], sources: [{ title: 'made up', url: 'https://example.com/x' }], confidence: 'web' },
        results: new Map(), cited: new Map() };
    },
  };
}
