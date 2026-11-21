/* Place details sheet + "ask first" candidate cards. Pure HTML builders; main.js wires events. */
import { esc } from './setup.js';

const ICO = {
  x: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  ext: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5"/></svg>',
  ok: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>',
  img: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 4 4 3-3 4 4"/></svg>',
};
export function safeUrl(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim().replace(/&amp;/g, '&');
  const markdown = /!?\[[^\]]*\]\(\s*<?(https?:\/\/[^\s>]+?)>?(?:\s+["'][^"']*["'])?\s*\)/i.exec(raw);
  const angle = /^<\s*(https?:\/\/[^>\s]+)\s*>$/i.exec(raw);
  let candidate = markdown?.[1] || angle?.[1] || raw;
  if (!/^https?:\/\//i.test(candidate)) candidate = (/https?:\/\/[^\s<>"']+/i.exec(candidate) || [])[0] || '';
  candidate = candidate.replace(/[\])},.;!?]+$/, '');
  try { const url = new URL(candidate); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}
const thb = n => n == null || n === '' || isNaN(+n) ? '' : '฿' + Math.round(+n).toLocaleString('en-US');
export const KIND_TH = { stay: 'ที่พัก', temple: 'วัด', food: 'ร้านอาหาร', nature: 'ธรรมชาติ', market: 'ตลาด', sight: 'ที่เที่ยว', transit: 'การเดินทาง', view: 'จุดชมวิว' };

/* photos: [{url, credit?, page?}] → horizontal scroll-snap strip, lazy, captioned */
export function photoStrip(photos, name, { eager = 1 } = {}) {
  const ps = (photos || []).map(p => typeof p === 'string' ? { url: p } : p).filter(p => p && safeUrl(p.url))
    .map((p, i) => ({ ...p, _i: i })).sort((a, b) => (a.match === 'likely') - (b.match === 'likely') || a._i - b._i);
  if (!ps.length) return '';
  return `<div class="photos" role="group" aria-label="รูป ${esc(name)}" tabindex="0">${ps.map((p, i) => {
    const page = safeUrl(p.page);
    const cr = p.credit ? (page ? `<a href="${esc(page)}" target="_blank" rel="noopener noreferrer">${esc(p.credit)}</a>` : esc(p.credit)) : (page ? `<a href="${esc(page)}" target="_blank" rel="noopener noreferrer">ที่มาของรูป</a>` : '');
    const likely = p.match === 'likely' ? '<span class="ph-likely">รูปจากเว็บ</span>' : '';
    return `<figure class="ph ${p.match === 'likely' ? 'likely' : ''}">${likely}<img src="${esc(safeUrl(p.url))}" alt="${esc(p.alt || `${name} รูปที่ ${i + 1}`)}" loading="${i < eager ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('figure').classList.add('broken')">${cr ? `<figcaption>${cr}</figcaption>` : ''}</figure>`;
  }).join('')}</div>${ps.length > 1 ? `<p class="ph-n">${ps.length} รูป · เลื่อนดูได้</p>` : ''}`;
}

const skeleton = () => `<div class="skel" aria-hidden="true"><div class="sk-img"></div><div class="sk-l w80"></div><div class="sk-l w60"></div><div class="sk-l w70"></div></div>`;
const trace = steps => `<ol class="trace">${(steps.length ? steps : ['กำลังเริ่ม…']).map((t, i, a) => `<li class="${i === a.length - 1 ? 'run' : 'done'}"><i class="ic"></i><span>${esc(t)}</span></li>`).join('')}</ol>`;

/**
 * Details sheet for a stop.
 * s = stop, I = st.info[s.id] ({state, steps, data, err, ms}), ctx = { when, isFood, errHTML, starName }
 */
export function sheetHTML(s, I, ctx) {
  const d = (I && I.data) || {}, det = d.details || {};
  const web = d.confidence === 'web' || (s.src && s.src.checked === 'web');
  const facts = [
    ['ราคา', det.price || d.priceRange || (s.cost ? `${thb(s.cost)}/คน (ในแผน)` : '')],
    ['เวลาเปิด', det.hours || d.hours || (s.open ? s.open.replace('-', '–') : '')],
    ['วันเปิด', ctx.open && (ctx.open.bad && ctx.open.text ? `${ctx.open.why} · ${ctx.open.text}` : ctx.open.label), ctx.open && ctx.open.bad],
    ['รายวัน', ctx.hours || ''],
    ['เรตติ้ง', det.rating != null && det.rating !== '' ? String(det.rating) : ''],
    ['การจอง', det.booking || (s.res ? 'ต้องโทรจอง' : ctx.isFood && s.walkin ? 'walk-in ได้' : '')],
    ['โทร', d.phone || ''],
    ['ที่อยู่', det.address || ''],
  ].filter(f => f[1]);
  const fact = ([k, v, bad]) => `<div class="${bad ? 'bad' : ''}"><dt>${k}</dt><dd>${esc(v)}</dd></div>`;
  let body = '';
  if (I && I.state === 'run') body = `${skeleton()}<p class="pi-h">Bop กำลังหาข้อมูลและรูป</p>${trace(I.steps || [])}`;
  else if (I && I.state === 'error') body = `<div class="errbox" role="alert"><b>${esc(ctx.errText)}</b>${ctx.errHTML || ''}</div><div class="call-a"><button class="btn sm ghost" type="button" data-sheet-retry="${esc(s.id)}">ลองใหม่</button></div>`;
  else if (I && I.state === 'done') {
    const src = (d.sources || []).map(x => ({ t: x.title || x.url, u: safeUrl(x.url) })).filter(x => x.u);
    if (s.src && safeUrl(s.src.url) && !src.some(x => x.u === safeUrl(s.src.url))) src.push({ t: s.src.title || s.src.url, u: safeUrl(s.src.url) });
    body = `${photoStrip(d.photos, s.n)}
      ${det.what || d.summary ? `<p class="sh-what">${esc(det.what || d.summary)}</p>` : ''}
      ${(det.highlights || []).length ? `<ul class="sh-hl">${det.highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
      ${facts.length ? `<dl class="sh-facts">${facts.map(fact).join('')}</dl>` : ''}
      ${ctx.isFood && (d.dishes || []).length ? `<p class="pi-h">เมนูแนะนำ</p><ul class="dishes">${d.dishes.map(x => `<li><span class="dn">${esc(x.name)}${x.veg ? '<span class="vg" title="มังสวิรัติ">เจ</span>' : ''}</span><span class="dp mono">${x.price != null && x.price !== '' ? '~' + thb(x.price) : '–'}</span>${x.why ? `<span class="dw">${esc(x.why)}</span>` : ''}</li>`).join('')}</ul>` : ''}
      ${(d.tips || []).length ? `<p class="pi-h">เคล็ดลับ</p><ul class="tips">${d.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${src.length ? `<p class="pi-h">แหล่งข้อมูล</p><ul class="srcs">${src.map(x => `<li><a href="${esc(x.u)}" target="_blank" rel="noopener noreferrer">${esc(x.t)}${ICO.ext}</a></li>`).join('')}</ul>` : ''}
      <p class="pi-conf ${web ? '' : 'est'}">${web ? 'ข้อมูลจากเว็บ อาจเปลี่ยนได้ เช็กอีกครั้งก่อนไป' : 'ประมาณการ ใช้เป็นแนวทางเท่านั้น'}</p>`;
  } else {
    body = facts.length ? `<dl class="sh-facts">${facts.map(fact).join('')}</dl>` : '';
  }
  return `<div class="sheet-in">
    <header class="sh-head">
      <span class="sh-k" aria-hidden="true"></span>
      <div class="sh-t"><p class="kicker">${esc(KIND_TH[s.k] || 'จุดแวะ')}${web ? `<span class="webmark">${ICO.ok}ตรวจจากเว็บ</span>` : ''}</p>
        <h2 id="sheet-title">${esc(s.n)}</h2>
        <p class="sh-when">${esc(ctx.when)}${s.star && ctx.starName ? ` · ${esc(ctx.starName)}อยากได้` : ''}</p></div>
      <button class="iconbtn sh-x" type="button" data-sheet-close aria-label="ปิดรายละเอียด">${ICO.x}</button>
    </header>
    ${s.note ? `<p class="sh-note">${esc(s.note)}</p>` : ''}
    ${ctx.stayWhy ? `<div class="sh-why"><p class="pi-h">ทำไมพักที่นี่</p><p>${esc(ctx.stayWhy)}</p></div>` : ''}
    <div class="sh-body" aria-busy="${!!(I && I.state === 'run')}">${body}</div>
  </div>`;
}

/* ---------- "ask first" candidate cards ---------- */
export const ANS = { yes: 'สนใจ', no: 'ไม่เอา', maybe: 'ไม่แน่ใจ' };
export function candCard(o, ans, attrs = '') {
  const ph = o.photo || (o.photos && o.photos[0]);
  const p = ph && (typeof ph === 'string' ? { url: ph } : ph);
  const img = p && safeUrl(p.url);
  const href = o.src && safeUrl(o.src.url);
  const name = o.n || o.name || '';
  const tags = (o.tags || []).filter(Boolean);
  return `<article class="cand ${ans ? 'a-' + ans : ''}" aria-label="${esc(name)}">
    <div class="cand-ph">${img ? `<img src="${esc(img)}" alt="${esc(name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('noimg');this.remove()">` : ''}<span class="cand-noimg" aria-hidden="true">${ICO.img}</span>
      ${p && p.match === 'likely' ? '<span class="ph-likely">รูปจากเว็บ</span>' : ''}${p && p.credit ? `<span class="cand-cr">${esc(p.credit)}</span>` : ''}</div>
    <div class="cand-b">
      <h3>${esc(name)}</h3>
      ${o.why ? `<p class="cand-why">${esc(o.why)}</p>` : ''}
      ${tags.length ? `<p class="cand-tags">${tags.map(t => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
      <p class="cand-meta">${o.price != null && o.price !== '' ? `<b class="mono">${typeof o.price === 'number' ? '~' + thb(o.price) + '/คน' : esc(o.price)}</b>` : ''}${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc((o.src && o.src.title) || 'ที่มา')}${ICO.ext}</a>` : ''}</p>
    </div>
    ${attrs !== null ? `<div class="cand-ans" role="radiogroup" aria-label="${esc(name)}: อยากให้ใส่ในแผนไหม">${Object.entries(ANS).map(([k, v]) =>
      `<button type="button" role="radio" aria-checked="${ans === k}" class="ans-${k}" ${attrs} data-ans="${k}">${v}</button>`).join('')}</div>` : ''}
  </article>`;
}
export function askHTML(q, qi, total, answers, busy) {
  return `<div class="ask-in">
    <header class="ask-h">
      <div class="ask-prog" aria-hidden="true">${Array.from({ length: total }, (_, i) => `<i class="${i < qi ? 'done' : i === qi ? 'cur' : ''}"></i>`).join('')}</div>
      <p class="kicker">คำถามที่ ${qi + 1} จาก ${total}</p>
      <h2 id="ask-title" tabindex="-1">${esc(q.title || q.q || 'อยากให้ใส่ที่เหล่านี้ในแผนไหม')}</h2>
      ${q.sub || q.why ? `<p class="ask-sub">${esc(q.sub || q.why)}</p>` : ''}
    </header>
    <div class="cands">${(q.options || []).map((o, i) => candCard(o, answers[o.id], `data-cand="${i}"`)).join('')}</div>
    <footer class="ask-f">
      <button class="btn ghost sm" type="button" data-ask="auto">ให้ Bop เลือกที่เหลือเอง</button>
      <span class="ask-sp"></span>
      <button class="btn ghost sm" type="button" data-ask="skip">ข้าม</button>
      <button class="btn" type="button" data-ask="next" ${busy ? 'disabled' : ''}>${qi + 1 < total ? 'ถัดไป' : 'วางแผนเลย'}</button>
    </footer>
  </div>`;
}
