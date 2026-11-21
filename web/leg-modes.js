// Modes within the itinerary are separate from the trip's arrival and departure services.
export const legLabels = {
  walk: 'เดิน',
  transit: 'ขนส่งสาธารณะ',
  rail: 'รถไฟ',
  metro: 'รถไฟฟ้า/รถไฟใต้ดิน',
  ferry: 'เรือโดยสาร',
  bus: 'รถโดยสารประจำทาง',
  red: 'รถแดง',
  car: 'รถรับจ้าง',
  van: 'รถตู้',
  own: 'รถส่วนตัว',
};
const aliases = {
  train: 'rail', รถไฟ: 'rail',
  subway: 'metro', underground: 'metro', รถไฟฟ้า: 'metro', รถไฟใต้ดิน: 'metro',
  boat: 'ferry', เรือ: 'ferry', เรือโดยสาร: 'ferry',
  city_bus: 'bus', รถบัส: 'bus', รถเมล์: 'bus',
};
export function legMode(value) {
  if (typeof value !== 'string') return;
  const key = value.trim().toLowerCase();
  if (Object.hasOwn(legLabels, key)) return key;
  if (Object.hasOwn(aliases, key)) return aliases[key];
}
export const isScheduledService = mode => ['rail', 'metro', 'ferry', 'bus'].includes(legMode(mode));
