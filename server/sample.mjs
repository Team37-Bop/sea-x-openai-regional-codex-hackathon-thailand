const chiangMai = [
  ['tha-phae', 'ประตูท่าแพ', 'sight', 18.7878, 98.9933, 0],
  ['warorot', 'ตลาดวโรรส', 'food', 18.7907, 99.0, 160],
  ['chedi-luang', 'วัดเจดีย์หลวง', 'sight', 18.7868, 98.9869, 50],
  ['bua-tong', 'น้ำตกบัวตอง', 'nature', 19.0699, 99.0804, 0],
  ['mae-taeng', 'มื้อกลางวันแม่แตง', 'food', 19.1142, 98.938, 190],
  ['city-art', 'หอศิลปวัฒนธรรมเมืองเชียงใหม่', 'sight', 18.79, 98.9868, 90],
  ['doi-suthep', 'วัดพระธาตุดอยสุเทพ', 'view', 18.8049, 98.9216, 60],
  ['ton-payom', 'ตลาดต้นพยอม', 'food', 18.7896, 98.9584, 170],
  ['ang-kaew', 'อ่างแก้ว', 'nature', 18.8031, 98.9478, 0],
  ['hua-lin', 'กาดหัวลิน', 'food', 18.7968, 98.9782, 140],
  ['chang-phuak', 'ตลาดประตูช้างเผือก', 'food', 18.7955, 98.9863, 110],
  ['chiangmai-gate', 'ตลาดประตูเชียงใหม่', 'food', 18.7823, 98.9887, 130],
  ['folk-museum', 'พิพิธภัณฑ์พื้นถิ่นล้านนา', 'sight', 18.7898, 98.988, 90],
  ['cnx', 'ท่าอากาศยานเชียงใหม่', 'transit', 18.7666, 98.9626, 0],
];
const daNang = [
  ['dragon', 'สะพานมังกร', 'sight', 16.0611, 108.2276, 0],
  ['han', 'ตลาดฮัน', 'food', 16.0687, 108.2245, 180],
  ['my-khe', 'หาดหมีเคว', 'nature', 16.0546, 108.2481, 0],
  ['marble', 'ภูเขาหินอ่อน', 'view', 16.0034, 108.2641, 90],
  ['ngu', 'มื้อกลางวันงูห่านเซิน', 'food', 16.0101, 108.2593, 170],
  ['cham', 'พิพิธภัณฑ์จาม', 'sight', 16.0605, 108.2231, 80],
  ['son-tra', 'ตลาดกลางคืนเซินจ่า', 'food', 16.061, 108.231, 160],
];
const list = (city) => (city === 'ดานัง' ? daNang : chiangMai);
function entry(row) {
  const [catalogId, name, kind, lat, lon, cost] = row;
  return { catalogId, name, kind, ll: [lat, lon], cost };
}
export function catalogPlace(city, row) {
  if (city !== 'เชียงใหม่' && city !== 'Chiang Mai') return null;
  const found = chiangMai.find((p) => p[0] === (row.catalogId ?? row.catalog) || p[0] === row.id);
  return found ? entry(found) : null;
}
export function sampleDay(city, index) {
  const isDaNang = city === 'ดานัง',
    places = list(city),
    n = index % (isDaNang ? 2 : 3);
  const order = n === 1 ? [5, 4, 3] : [n * 3, n * 3 + 1, n * 3 + 2];
  order.push(isDaNang ? 6 : 9 + n);
  return {
    title: ['เดินรอบเมืองเก่า', 'ออกไปสัมผัสธรรมชาติ', 'เก็บจุดโปรดก่อนกลับ'][n],
    stops: order.map((idx, i) => {
      const stop = entry(places[idx]);
      return {
        ...stop,
        id: 'd' + (index + 1) + '_' + (i + 1),
        start: ['10:00', '12:00', '14:00', '18:00'][i],
        end: ['11:00', '13:00', '15:20', '18:45'][i],
        mode: i === 2 && n === 0 ? 'walk' : 'car',
        walk: [0.4, 0.3, 0.5, 0.2][i],
        ...(i === 1 || i === 3 ? { meal: i === 1 ? 'lunch' : 'dinner', diet: true, veg: true } : {}),
        ...(i === 1 && n === 0 ? { res: { todo: true, note: 'ตรวจสอบจำนวนที่นั่งก่อนเดินทาง' } } : {}),
      };
    }),
  };
}
export function indoor(stop, city = 'เชียงใหม่') {
  const replacement = entry(city === 'ดานัง' ? daNang[5] : chiangMai[12]);
  return {
    ...replacement,
    start: stop.t0 ?? stop.start,
    end: stop.t1 ?? stop.end,
    outdoor: false,
    walk: 0.3,
    cost: replacement.cost,
  };
}
