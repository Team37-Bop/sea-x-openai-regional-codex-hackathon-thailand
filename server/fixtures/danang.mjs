// Da Nang fixture for the fake LLM (BOP_FAKE_LLM=1): a realistic multi-day plan with real places and coordinates,
// so the UI can reproduce international plans (map, routes, checks) without spending model calls.
const H = { n: 'โรงแรมเมืองถั่นลักชัวรี ดานัง', query: 'Muong Thanh Luxury Da Nang', lat: 16.0646, lng: 108.2466 };
const st = (id, n, k, t0, t1, query, lat, lng, mode, x = {}) => ({
  id, n, k, t0, t1, query, catalog: '', lat, lng, cost: 0, walk: 0, open: '', meal: '', veg: false, walkin: false, outdoor: false, dress: false,
  star: '', note: '', reserve: false, resAsk: '', resBy: '', mode, legCost: -1, legWhy: '', srcUrl: '', srcTitle: '', checked: 'estimate',
  legMin: 0, legSrcUrl: '', legSrcTitle: '', legChecked: 'estimate', localAmount: 0, localCurrency: '', ...x });
const hotel = (id, t0, t1, mode, x) => st(id, H.n, 'stay', t0, t1, H.query, H.lat, H.lng, mode, x);
const food = (id, n, t0, t1, q, lat, lng, mode, meal, cost, x = {}) => st(id, n, 'food', t0, t1, q, lat, lng, mode, { meal, cost, walkin: true, veg: true, ...x });

const FIRST = (arr, wisher) => [
  st('dad', 'ถึงสนามบินดานัง', 'transit', arr, arr, 'Da Nang International Airport', 16.0439, 108.1994, 'none', { star: wisher, note: 'ถึงเวียดนามตอนเช้า' }),
  hotel('hotel1', '11:15', '11:45', 'car', { cost: 2400, note: 'ฝากกระเป๋า · 5 คืน หาร 3' }),
  food('miquang', 'หมี่กว๋าง บ่าหมัว', '12:15', '13:00', 'Mì Quảng Bà Mua', 16.0661, 108.2195, 'car', 'lunch', 90, { localAmount: 60000, localCurrency: 'VND', note: 'มีหมี่กว๋างผัก' }),
  st('hanmarket', 'ตลาดฮาน', 'market', '13:15', '14:30', 'Han Market', 16.0683, 108.2242, 'car', { cost: 300, walk: 0.5, open: '06:00-19:00' }),
  st('cathedral', 'โบสถ์สีชมพูดานัง', 'sight', '14:40', '15:10', 'Da Nang Cathedral', 16.0667, 108.2232, 'walk', { walk: 0.2, open: '08:00-16:30', dress: true }),
  hotel('rest1', '15:40', '17:30', 'car', { note: 'เช็กอิน พักผ่อน' }),
  food('beman', 'ร้านซีฟู้ดเบ๋หมัน', '18:00', '19:30', 'Hải sản Bé Mặn', 16.0626, 108.2476, 'walk', 'dinner', 450, { open: '10:00-23:00' }),
  hotel('end1', '19:45', '19:45', 'walk'),
];
const MID = [
  (d) => [
    hotel(`start${d}`, '07:30', '07:30', 'none'),
    st(`bana${d}`, 'บานาฮิลล์ · สะพานมือทองคำ', 'sight', '08:30', '12:00', 'Ba Na Hills', 15.9977, 107.9884, 'van', { cost: 1900, walk: 1, open: '07:00-22:00', outdoor: true, legCost: 400, legWhy: 'เหมารถตู้ไปกลับ ฿1,200 หาร 3', localAmount: 900000, localCurrency: 'VND' }),
    food(`banalunch${d}`, 'บุฟเฟต์บนบานาฮิลล์ (มีไลน์มังสวิรัติ)', '12:10', '13:10', 'Ba Na Hills French Village', 15.9953, 107.9963, 'walk', 'lunch', 450),
    st(`banafv${d}`, 'บานาฮิลล์ · หมู่บ้านฝรั่งเศส', 'sight', '13:15', '15:30', 'Ba Na Hills French Village', 15.9953, 107.9963, 'walk', { walk: 0.5, outdoor: true }),
    hotel(`rest${d}`, '16:45', '17:45', 'van', { legCost: 0 }),
    food(`madamelan${d}`, 'มาดามหลั่น', '18:15', '19:45', 'Madame Lân', 16.0767, 108.2237, 'car', 'dinner', 350, { open: '06:30-22:00' }),
    hotel(`end${d}`, '20:00', '20:00', 'car'),
  ],
  (d) => [
    hotel(`start${d}`, '08:30', '08:30', 'none'),
    st(`marble${d}`, 'ภูเขาหินอ่อน (หงูหั่นเซิน)', 'sight', '09:00', '10:30', 'Marble Mountains', 16.0036, 108.2632, 'van', { cost: 120, walk: 1, open: '07:00-17:30', dress: true, legCost: 500, legWhy: 'เหมารถตู้ทั้งวัน ฿1,500 หาร 3' }),
    food(`banhmi${d}`, 'บั๋นหมี่ฟู้อง ฮอยอัน', '11:30', '12:15', 'Bánh Mì Phượng', 15.8798, 108.3330, 'van', 'lunch', 60, { legCost: 0 }),
    st(`hoian${d}`, 'เมืองเก่าฮอยอัน', 'sight', '12:30', '17:45', 'Hoi An Ancient Town', 15.8771, 108.3280, 'walk', { cost: 180, walk: 1.5 }),
    food(`morningglory${d}`, 'มอร์นิ่งกลอรี่ ฮอยอัน', '18:00', '19:30', 'Morning Glory Restaurant Hoi An', 15.8768, 108.3270, 'walk', 'dinner', 400),
    hotel(`end${d}`, '20:30', '20:30', 'van', { legCost: 0 }),
  ],
  (d) => [
    hotel(`start${d}`, '08:00', '08:00', 'none'),
    st(`linhung${d}`, 'วัดลินห์อึ๋ง เซินจ่า', 'sight', '08:30', '10:00', 'Linh Ung Pagoda', 16.1001, 108.2779, 'car', { walk: 0.4, dress: true, open: '06:00-21:00' }),
    st(`mykhe${d}`, 'หาดหมีเคว', 'nature', '10:30', '12:00', 'My Khe Beach', 16.0600, 108.2470, 'car', { outdoor: true, walk: 0.3 }),
    food(`banhxeo${d}`, 'บั๋นแซ่ว บ่าเยือง', '12:30', '13:30', 'Bánh xèo Bà Dưỡng', 16.0584, 108.2116, 'car', 'lunch', 100, { open: '09:00-21:30' }),
    st(`conmarket${d}`, 'ตลาดก๋น', 'market', '13:45', '15:00', 'Con Market', 16.0688, 108.2142, 'car', { cost: 150, walk: 0.4 }),
    hotel(`rest${d}`, '15:30', '17:30', 'car'),
    st(`sontra${d}`, 'ตลาดกลางคืนเซินจ่า', 'market', '18:00', '20:00', 'Son Tra Night Market', 16.0628, 108.2307, 'car', { meal: 'dinner', veg: true, walkin: true, cost: 250, walk: 0.6, open: '17:00-23:30' }),
    hotel(`end${d}`, '20:15', '20:15', 'car'),
  ],
];
const LAST = (dep) => {
  const toM = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const f = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const ap = f(Math.max(toM('13:30'), toM(dep || '16:30') - 120));
  return [
    hotel('checkout', '09:00', '09:00', 'none', { note: 'เช็กเอาต์ ฝากกระเป๋า' }),
    st('dragon', 'สะพานมังกร', 'sight', '09:30', '10:15', 'Dragon Bridge', 16.0612, 108.2272, 'car', { outdoor: true, walk: 0.5 }),
    food('buncha', 'บุ๋นจ่าก๋า บ่าหลือ', '11:00', '11:45', 'Bún chả cá Bà Lữ', 16.0700, 108.2185, 'car', 'lunch', 70),
    hotel('pickup', '12:15', '12:30', 'car', { note: 'รับกระเป๋า' }),
    st('dad_out', 'สนามบินดานัง', 'transit', ap, ap, 'Da Nang International Airport', 16.0439, 108.1994, 'car'),
  ];
};

export function danangDays(setup) {
  const wisher = (setup.members.find(m => m.wants && m.wants.length) || {}).id || '';
  const n = Math.max(1, setup.days);
  const days = [{ stops: FIRST((setup.arrive && setup.arrive.time) || '10:30', wisher) }];
  for (let i = 1; i < n - 1; i++) days.push({ stops: MID[(i - 1) % MID.length](i + 1) });
  if (n > 1) days.push({ stops: LAST(setup.depart && setup.depart.time) });
  return days;
}

export const DANANG_CANDIDATES = { questions: [
  { id: 'q_food', kind: 'food', title: 'ร้านพวกนี้น่าสนใจ อยากให้ใส่ในแผนไหม', options: [
    { id: 'madame_lan', name: 'Madame Lân', query: 'Madame Lân', why: 'ร้านอาหารเวียดนามกลางริมแม่น้ำฮาน เมนูครบ', tags: ['ริมแม่น้ำ', 'มีเมนูเจ'], price: '~฿200–400 ต่อคน', lat: 16.0767, lng: 108.2237, srcUrl: '', srcTitle: '', checked: 'estimate' },
    { id: 'banh_xeo', name: 'Bánh xèo Bà Dưỡng', query: 'Bánh xèo Bà Dưỡng', why: 'บั๋นแซ่วเจ้าดังของดานัง', tags: ['ร้านท้องถิ่น', 'ราคาถูก'], price: '~฿80–120 ต่อคน', lat: 16.0584, lng: 108.2116, srcUrl: '', srcTitle: '', checked: 'estimate' },
    { id: 'mi_quang', name: 'Mì Quảng Bà Mua', query: 'Mì Quảng Bà Mua', why: 'หมี่กว๋างเมนูประจำเมือง มีแบบผัก', tags: ['อาหารเช้า-กลางวัน', 'มีเมนูเจ'], price: '~฿60–100 ต่อคน', lat: 16.0661, lng: 108.2195, srcUrl: '', srcTitle: '', checked: 'estimate' },
    { id: 'be_man', name: 'Hải sản Bé Mặn', query: 'Hải sản Bé Mặn', why: 'ซีฟู้ดริมหาดหมีเคว เลือกสดจากบ่อ', tags: ['ซีฟู้ด', 'ใกล้ทะเล'], price: '~฿300–600 ต่อคน', lat: 16.0626, lng: 108.2476, srcUrl: '', srcTitle: '', checked: 'estimate' },
  ] },
  { id: 'q_sight', kind: 'sight', title: 'ที่เที่ยวพวกนี้ อยากไปที่ไหนบ้าง', options: [
    { id: 'ba_na', name: 'Ba Na Hills', query: 'Ba Na Hills', why: 'สะพานมือทองคำ กระเช้ายาวติดอันดับโลก', tags: ['ทั้งวัน', 'วิวภูเขา'], price: '~฿1,900 ต่อคน', lat: 15.9977, lng: 107.9884, srcUrl: '', srcTitle: '', checked: 'estimate' },
    { id: 'hoi_an', name: 'Hoi An Ancient Town', query: 'Hoi An Ancient Town', why: 'เมืองมรดกโลก โคมไฟยามค่ำ', tags: ['มรดกโลก', 'ถ่ายรูป'], price: '~฿180 ต่อคน', lat: 15.8771, lng: 108.3280, srcUrl: '', srcTitle: '', checked: 'estimate' },
    { id: 'marble', name: 'Marble Mountains', query: 'Marble Mountains', why: 'ถ้ำและวัดในภูเขาหินอ่อน', tags: ['ถ้ำ', 'เดินขึ้นบันได'], price: '~฿120 ต่อคน', lat: 16.0036, lng: 108.2632, srcUrl: '', srcTitle: '', checked: 'estimate' },
    { id: 'linh_ung', name: 'Linh Ung Pagoda', query: 'Linh Ung Pagoda', why: 'เจ้าแม่กวนอิมองค์ใหญ่ วิวอ่าวดานัง', tags: ['วิวทะเล', 'ฟรี'], price: '', lat: 16.1001, lng: 108.2779, srcUrl: '', srcTitle: '', checked: 'estimate' },
  ] },
] };
