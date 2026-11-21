import { mediaUrl } from './setup-extras.js';

// URLs can contain parentheses in article titles and brackets in query keys or IPv6 hosts.
const segment = /(?:[^\s()<>[\]]|\[[^\s()<>[\]]*\])/;
const destination = String.raw`(?:${segment.source}|\((?:${segment.source}|\(${segment.source}*\))*\))+`;
const markdownLink = new RegExp(String.raw`(!?)\[([^\]\n]*)\]\(\s*<?(${destination})>?(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)`, 'gi');
const citationLabel = /(?:sources?|citations?|แหล่งข้อมูล|แหล่งอ้างอิง|ที่มา|อ้างอิง)/;
const domain = /(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?:[/?#][^\s<>()\[\],;]*)?/;
const sourceHost = String.raw`(?:https?://)?${domain.source}`;
const parentheticalSource = new RegExp(String.raw`\(\s*(?:${citationLabel.source}\s*[:：]\s*)?(${sourceHost}(?:\s*[,;]\s*${sourceHost})*)\s*\)`, 'gi');
const address = String.raw`(?:https?://|www\.)${destination}`;
const bareLink = new RegExp(String.raw`(?:${citationLabel.source}\s*[:：]\s*)?(?:<(${address})>|(${address}))`, 'gi');
const labelOnly = new RegExp(`^(?:${citationLabel.source}|${domain.source})$`, 'i');

export function splitStopNote(value) {
  const sources = new Set();
  function keep(url) {
    const href = mediaUrl(/^https?:/i.test(url) ? url : 'https://' + url);
    if (href) sources.add(href);
  }
  const text = String(value ?? '')
    .replace(/\\([()[\]:<>])/g, '$1')
    .replace(/\\(?=\r?\n)/g, '')
    .replace(markdownLink, (_, image, label, url) => {
      if (/^https:\/\//i.test(url)) keep(url);
      return image || labelOnly.test(label.trim()) || /^https?:\/\//i.test(label.trim()) ? '' : label;
    })
    .replace(parentheticalSource, (_, urls) => {
      for (const url of urls.split(/\s*[,;]\s*/)) keep(url);
      return '';
    })
    .replace(bareLink, (_, wrapped, bare) => {
      const clean = wrapped || bare.replace(/[.,;:!?]+$/, '');
      keep(clean);
      return bare ? bare.slice(clean.length) : '';
    })
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/[ \t]+(?=\r?\n)/g, '')
    .replace(/[ \t]+([.,;!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return { text, sources: [...sources] };
}

export function renderStopNote(value, className) {
  const { text } = splitStopNote(value);
  if (!text) return null;
  const note = document.createElement('p');
  note.className = className;
  note.textContent = text;
  return note;
}
