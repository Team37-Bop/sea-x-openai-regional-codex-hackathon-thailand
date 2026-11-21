import { mediaUrl } from './setup-extras.js';

// A destination can contain balanced parentheses, e.g. a Wikipedia article title.
const destination = /(?:[^\s()<>]|\((?:[^\s()<>]|\([^\s()<>]*\))*\))+/;
const markdownLink = new RegExp(String.raw`(!?)\[([^\]\n]*)\]\(\s*<?(${destination.source})>?\s*\)`, 'gi');
const bareLink = new RegExp(String.raw`https?://${destination.source}`, 'gi');

export function splitStopNote(value) {
  const sources = new Set();
  function keep(url) {
    const href = mediaUrl(url);
    if (href) sources.add(href);
  }
  const text = String(value ?? '')
    .replace(markdownLink, (_, image, label, url) => {
      keep(url);
      const sourceLabel = /^(?:https?:\/\/|www\.)|^(?:[\w-]+\.)+[a-z]{2,}(?:[/?#].*)?$/i.test(label.trim());
      return image || sourceLabel || /^(?:source|citation|แหล่งข้อมูล|ที่มา)$/i.test(label.trim()) ? '' : label;
    })
    .replace(bareLink, (url) => {
      const clean = url.replace(/[.,;:!?]+$/, '');
      keep(clean);
      return url.slice(clean.length);
    })
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return { text, sources: [...sources] };
}

export function renderStopNote(value, className, source) {
  const { text, sources } = splitStopNote(value);
  if (!text && !sources.length) return null;
  const verifiedPage = source?.checked === 'web' ? mediaUrl(source.url).split('#')[0] : '';
  const note = document.createElement('p');
  note.className = className;
  if (text) note.append(text);
  for (const [index, href] of sources.entries()) {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    const label = href.split('#')[0] === verifiedPage ? 'แหล่งข้อมูล' : 'ลิงก์ในหมายเหตุ';
    anchor.textContent = sources.length === 1 ? label : label + ' ' + (index + 1);
    anchor.setAttribute('aria-label', anchor.textContent + ' ' + new URL(href).hostname);
    note.append(' ', anchor);
  }
  return note;
}
