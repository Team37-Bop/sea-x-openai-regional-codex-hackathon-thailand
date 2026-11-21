import { coordinates, distance } from './domain.mjs';
import { findCity, findSavedVenue } from './geo.mjs';
import { model } from './model.mjs';
import { placeText, sourceIdentity } from './place-text.mjs';

const namedProperty = /hotel|hostel|resort|suites?|\binn\b|lodg(?:e|ing)|โรงแรม|โฮเทล|โฮสเทล|รีสอร์ต|รีสอร์ท/i;
function acceptableName(name) {
  return name && !/^(?:ที่พัก(?:ย่าน|ใน|ใกล้)|โรงแรม(?:ย่าน|ในย่าน|ใกล้)|(?:hotel|accommodation) (?:in|near)\b)|ยังไม่(?:ได้เลือก|ระบุ)(?:โรงแรม|ที่พัก)/i.test(name);
}
function nearby(ll, setup) {
  return coordinates(ll) && (!coordinates(setup.cityLL) || distance(setup.cityLL, ll) < 100);
}
export function checkedHotelExamples(stay, verified) {
  const urls = new Map([...verified].map(url => [sourceIdentity(url), url]));
  return (Array.isArray(stay?.examples) ? stay.examples : []).filter(e => acceptableName(placeText(e?.name)))
    .slice(0, 3).map(e => {
      const src = e.src || e;
      const url = urls.get(sourceIdentity(src.url));
      return {
        name: placeText(e.name), query: placeText(e.query || e.name, 300),
        ...(coordinates(e.ll) ? { ll: e.ll } : {}),
        priceNight: Number(e.priceNight) > 0 ? Number(e.priceNight) : null,
        url: url || '', title: url ? placeText(src.title || e.name) : '', checked: url ? 'web' : 'estimate',
        why: placeText(e.why, 350),
      };
    });
}

// Use the same branch identity across a saved plan, its picker and a later selection.
export function hotelOptions(hotels, setup) {
  const options = new Map();
  for (const row of hotels) {
    const name = placeText(row?.name);
    if (!acceptableName(name) || !nearby(row.ll, setup)) continue;
    const url = row.checked === 'web' ? sourceIdentity(row.url) : '';
    if (!(row.checked === 'web' && url) && !['geocoded', 'pick'].includes(row.locationSource)) continue;
    const id = 'hotel-' + encodeURIComponent(name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' '));
    if (!options.has(id)) options.set(id, {
      id, name, query: placeText(row.query || name, 300), ll: row.ll.slice(0, 2),
      why: placeText(row.why, 350), priceNight: row.checked === 'web' && url && Number(row.priceNight) > 0 && Number.isFinite(Number(row.priceNight)) ? Number(row.priceNight) : null,
      checked: row.checked === 'web' && url ? 'web' : 'estimate', url, title: url ? placeText(row.title || name) : '',
      locationSource: ['pick', 'geocoded'].includes(row.locationSource) ? row.locationSource : 'model',
    });
    if (options.size === 3) break;
  }
  return [...options.values()];
}

// One selected property supplies every overnight anchor. Candidate survey neighborhoods are search hints.
export async function selectLodging(setup, stay, examples, ctx, search) {
  if (setup.days < 2 || setup.stay?.mode !== 'auto') return;
  const picks = (setup.picks?.must || []).filter(p => ['hotel', 'stay'].includes(p.kind));
  const exact = picks.find(p => acceptableName(p.name) &&
    (p.kind === 'hotel' || namedProperty.test(p.name) || examples.some(e => e.name === p.name)));
  if (exact) {
    const example = examples.find(e => e.name === exact.name);
    const query = exact.query || exact.name;
    const pickedLL = nearby(exact.ll, setup) ? exact.ll : null;
    const ll = pickedLL || (nearby(example?.ll, setup) ? example.ll : null) ||
      (search && await findSavedVenue({ name: exact.name, query }, (await findCity(setup.city, ctx.signal))?.ll, ctx.signal, { remaining: 2 }));
    if (!nearby(ll, setup)) return;
    return { hotel: { ...example, name: exact.name, query, ll, locationSource: pickedLL ? 'pick' : example?.ll === ll ? 'model' : 'geocoded' },
      selection: 'chosen', options: [], why: 'ใช้ที่พักที่กลุ่มเลือกในการวางแผน' };
  }
  let options = hotelOptions(examples, setup);
  const result = () => options.length ? { hotel: options[0], options, selection: 'provisional',
    why: options[0].why || placeText(stay?.why, 400) } : undefined;
  if (options.length >= 2 || !search) return result();
  ctx.step('Bop กำลังหาตัวเลือกที่พักสำหรับ ' + (setup.days - 1) + ' คืน');
  try {
    const { value, verified } = await model(
      'ค้นหาโรงแรมที่มีชื่อสาขาจริง 2–3 แห่งสำหรับให้ผู้ใช้เลือก ใส่ตัวเลือกที่แนะนำเป็นอันดับแรกใน options ยังไม่มีการจอง ' +
      'เลือกโรงแรมที่เข้าถึงขนส่งสาธารณะสะดวกในย่านที่ระบุ ค้นเว็บของโรงแรมหรือเว็บไซต์ที่ระบุที่อยู่จริงของสาขา ' +
      'คืนชื่อจริง ที่อยู่ (query เป็นชื่อโรงแรม, เลขที่ ถนน, เมือง) ' +
      'พิกัดของตัวโรงแรม ll=[lat,lng] เลี่ยงพิกัดย่านหรือสถานี ระบุ src.url ของหน้าที่เปิดตรวจ ราคาโดยประมาณต่อห้องต่อคืนเป็นบาท หรือ 0 เมื่อไม่มีข้อมูล ' +
      'why บอกสั้น ๆ ว่าไปจุดเที่ยวสะดวกอย่างไร ไม่อ้างว่ามีห้องว่างหรือรับฝากกระเป๋า ถ้ายืนยันที่พักไม่ได้ให้เว้นชื่อและพิกัด',
      {
        city: setup.city, area: placeText(setup.hotelArea || stay?.area || picks[0]?.name).split(/\s+ฝั่ง\s*/u)[0],
        startDate: setup.startDate, endDate: setup.endDate,
      }, { signal: ctx.signal, usage: ctx.usage, step: ctx.step, operation: 'lodging', quick: true, searches: 3 },
    );
    const found = checkedHotelExamples({ examples: value.options }, verified);
    let cityCenter;
    for (const hotel of found) {
      if (options.length === 3) break;
      if (options.some(row => row.name.toLowerCase() === hotel.name.toLowerCase())) continue;
      const center = nearby(hotel.ll, setup) ? hotel.ll : (cityCenter ??= (await findCity(setup.city, ctx.signal))?.ll);
      const ll = await findSavedVenue({ name: hotel.name, query: hotel.query }, center, ctx.signal, { remaining: 2 });
      if (ll) Object.assign(hotel, { ll, locationSource: 'geocoded' });
      options = hotelOptions([...options, hotel], setup);
    }
  } catch (error) {
    if (!options.length || ctx.signal?.aborted) throw error;
  }
  return result();
}
