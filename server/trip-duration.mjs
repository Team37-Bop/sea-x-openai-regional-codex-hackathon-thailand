const thaiNumbers = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า', 'สิบ'];
const englishNumbers = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const number = '(?:\\d+(?:\\.\\d+)?|' + [...thaiNumbers, ...englishNumbers].join('|') + ')';
const trip = '(?:จำนวนวัน(?:เที่ยว|ในทริป)?|ระยะเวลา(?:ทริป)?|วัน(?:เที่ยว|เดินทาง)?|ทริป|แผน(?:เที่ยว)?)?';
const days = '(' + number + ')\\s*วัน(?!ที่)';
const object = '(?:\\s+(?:my|our|the|this|it|trip|itinerary|stay|length|duration))*';
const englishDays = '(' + number + ')[- ](?:more )?days?\\b';
const rules = [
  ['set', new RegExp('(?:ปรับ|เปลี่ยน|ขยาย|เพิ่ม|ลด|ย่อ|ตัด|ขอ)\\s*' + trip +
    '\\s*(?:จาก\\s*' + number + '\\s*วัน)?\\s*(?:ลง|ให้)?\\s*(?:เหลือ|เป็น|รวม(?:เป็น)?)\\s*' + days)],
  ['set', new RegExp('(?:จัดทริป|อยากเที่ยว|ขอ(?:ไป)?เที่ยว|อยากไปเที่ยว|เที่ยวทั้งหมด|ทริปยาว)\\s*(?:แค่|รวม|ทั้งหมด|สัก)?\\s*' + days)],
  ['add', new RegExp('(?:เพิ่ม|ขยาย|ต่อ|ยืด|เที่ยวต่อ|อยู่ต่อ)\\s*' + trip + '\\s*(?:ให้ยาวขึ้น|เพิ่ม|ขึ้น)?\\s*(?:อีก|ไปอีก)?\\s*' + days)],
  ['subtract', new RegExp('(?:ลด|ตัด|ย่อ|หั่น)\\s*' + trip + '\\s*(?:ออก|สั้นลง|ลง)?\\s*(?:อีก|ไป)?\\s*' + days)],
  ['set', new RegExp('\\b(?:set|change|shorten|extend|reduce|cut|increase)' + object + '\\s+to\\s+' + englishDays)],
  ['set', new RegExp('\\bmake' + object + '\\s+(?:a\\s+)?' + englishDays)],
  ['add', new RegExp('\\b(?:add|extend)' + object + '\\s+(?:by\\s+)?(?:another\\s+)?' + englishDays)],
  ['subtract', new RegExp('\\b(?:remove|drop|subtract|cut|shorten|reduce)' + object + '\\s+(?:by\\s+)?' + englishDays)],
];
const negated = /(?:ไม่(?:อยาก|ต้องการ|ต้อง)?(?:ให้)?|อย่า|ห้าม|do not|don't|never)\s*$/;

export function requestedTripDays(command, currentDays) {
  if (typeof command !== 'string') return null;
  const text = command.toLowerCase()
    .replace(/[๐-๙]/g, (digit) => String(digit.charCodeAt(0) - 0x0e50))
    .replace(/(?:ไป)?อีก\s*วัน(?!ที่)|วันหนึ่ง/g, 'อีก 1 วัน')
    .replace(/\b(?:another|a|an) day\b/g, 'one day');
  for (const [mode, pattern] of rules) {
    const match = pattern.exec(text);
    if (!match || negated.test(text.slice(0, match.index))) continue;
    const amount = /^\d/.test(match[1])
      ? Number(match[1])
      : Math.max(thaiNumbers.indexOf(match[1]), englishNumbers.indexOf(match[1]));
    if (mode === 'set') return amount;
    return currentDays + (mode === 'add' ? amount : -amount);
  }
  return null;
}
