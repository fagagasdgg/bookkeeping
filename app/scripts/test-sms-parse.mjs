import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Inline minimal copy of parse logic for smoke test (avoid TS import path issues)
function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  if (m) return decodeXmlEntities(m[1]);
  const m2 = tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m2 ? decodeXmlEntities(m2[1]) : '';
}
function parse(xml) {
  const out = [];
  const tagRe = /<(sms|item|message|msg)\b([^>]*?)(\/?)>/gi;
  let m;
  while ((m = tagRe.exec(xml))) {
    const tagName = (m[1] || '').toLowerCase();
    const attrs = m[2] || '';
    const hasBodyAttr = /\b(body|content|msg|text|message)\s*=/i.test(attrs);
    if (tagName === 'sms' && !hasBodyAttr) continue;
    const body = attr(attrs, 'body') || attr(attrs, 'content');
    if (!body.trim()) continue;
    out.push({ address: attr(attrs, 'address') || '(空)', body });
  }
  return out;
}

const vivo = `<?xml version='1.0'?><sms>
<item address='95588' date='1' type='1' body='支出16.50元' />
<item address='10086' date='2' type='1' body='话费' />
</sms>`;
const sbr = `<?xml version='1.0'?><smses><sms address='95588' date='1' type='1' body='支出200元' /></smses>`;
console.log('vivo', parse(vivo));
console.log('sbr', parse(sbr));
