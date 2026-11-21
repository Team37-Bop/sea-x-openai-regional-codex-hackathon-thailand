export const stopKinds = ['food', 'sight', 'hotel', 'nature', 'view', 'transit', 'market', 'stay', 'terminal'];

// Older plans and non-strict providers can supply a description in the kind field.
const kindLabels = [
  [
    'food',
    /คาเฟ่?|คาแฟ่|ร้านกาแฟ|ร้านอาหาร|ของกิน|ภัตตาคาร|ร้านขนม|เบเกอร[ีี่]+|กินข้าว|ทานข้าว|มื้อ|restaurant|caf[eé]|dining|bakery|eatery/i,
  ],
  ['hotel', /โรงแรม|ที่พัก|รีสอร[์]?ท|โฮสเทล|เช็ก(?:อิน|เอาต์)|check.?in|check.?out|hotel|lodging|resort|hostel/i],
  ['transit', /สนามบิน|ท่าอากาศยาน|สถานี|ท่าเรือ|จุดเดินทาง|จุดรับส่ง|จุดขนส่ง|airport|station|terminal|transit|transport/i],
  ['view', /จุดชมวิว|จุดชมทิวทัศน์|จุดชมพระอาทิตย์|viewpoint|lookout|scenic view/i],
  [
    'nature',
    /ธรรมชาติ|น้ำตก|ชายหาด|อุทยาน|สวนสาธารณะ|เดินป่า|เส้นทางศึกษาธรรมชาติ|hiking|hike|waterfall|national park|beach/i,
  ],
  ['market', /ตลาด|กาด|market|bazaar/i],
  ['sight', /พิพิธภัณฑ์|วัด|สถานที่เที่ยว|แหล่งท่องเที่ยว|museum|temple|gallery/i],
  ['food', /อาหาร|กาแฟ|เครื่องดื่ม|food|coffee|lunch|dinner|breakfast/i],
];

export function stopKind(value, fallback = 'sight') {
  const label = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (stopKinds.includes(label)) return label;
  return kindLabels.find(([, pattern]) => pattern.test(label))?.[0] || fallback;
}
