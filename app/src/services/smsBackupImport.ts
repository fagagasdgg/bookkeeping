import { Capacitor } from '@capacitor/core';
import { FilePicker, type PickedFile } from '@capawesome/capacitor-file-picker';
import { unzipSync, strFromU8, gunzipSync } from 'fflate';
import { ingestMany } from './ingest';
import { addressMatches, bodyLooksLikeLedgerSms } from './smsFilters';
import type { IngestResult } from './types';

export interface ParsedBackupSms {
  address: string;
  body: string;
  date: number;
  type?: number;
  contactName?: string;
  ledgerLike: boolean;
  via?: string;
}

export interface SmsAddressGroup {
  address: string;
  contactName?: string;
  total: number;
  ledgerCount: number;
  messages: ParsedBackupSms[];
}

/** 可复制给开发者的解析诊断报告 */
export interface SmsParseReport {
  fileName: string;
  byteLength: number;
  magicHex: string;
  kind: 'zip' | 'gzip' | 'xml' | 'text' | 'unknown';
  zipEntries: string[];
  chosenEntry?: string;
  xmlHead: string;
  xmlTail: string;
  tagCounts: Record<string, number>;
  attrCounts: Record<string, number>;
  strategies: Array<{ name: string; count: number; sample?: string }>;
  parseCount: number;
  ledgerCount: number;
  error?: string;
  rawTextPreview?: string;
}

export interface SmsBackupPreview {
  fileName: string;
  total: number;
  ledgerCount: number;
  otherCount: number;
  groups: SmsAddressGroup[];
  messages: ParsedBackupSms[];
  report: SmsParseReport;
  debug?: string;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** 支持跨行属性值 */
function attr(blob: string, name: string): string {
  const reDq = new RegExp(`\\b${name}\\s*=\\s*"([\\s\\S]*?)"`, 'i');
  const m = blob.match(reDq);
  if (m) return decodeXmlEntities(m[1]);
  const reSq = new RegExp(`\\b${name}\\s*=\\s*'([\\s\\S]*?)'`, 'i');
  const m2 = blob.match(reSq);
  return m2 ? decodeXmlEntities(m2[1]) : '';
}

function firstText(
  blob: string,
  names: string[],
): string {
  for (const n of names) {
    const v = attr(blob, n);
    if (v.trim()) return v;
  }
  return '';
}

function toMessage(
  fields: {
    address?: string;
    body?: string;
    date?: string | number;
    type?: string | number;
    contactName?: string;
  },
  via: string,
): ParsedBackupSms | null {
  const body = (fields.body || '').trim();
  if (!body) return null;
  const dateNum = Number(fields.date);
  return {
    address: (fields.address || '').trim() || '(空地址)',
    body,
    date: Number.isFinite(dateNum) && dateNum > 0 ? dateNum : Date.now(),
    type: fields.type != null && fields.type !== '' ? Number(fields.type) : undefined,
    contactName: fields.contactName || undefined,
    ledgerLike: bodyLooksLikeLedgerSms(body),
    via,
  };
}

function countTags(xml: string): Record<string, number> {
  const names = [
    'smses',
    'sms',
    'item',
    'message',
    'msg',
    'mms',
    'part',
    'thread',
    'conversation',
    'record',
    'row',
  ];
  const out: Record<string, number> = {};
  for (const n of names) {
    const c = (xml.match(new RegExp(`<${n}\\b`, 'gi')) || []).length;
    if (c) out[n] = c;
  }
  return out;
}

function countAttrs(xml: string): Record<string, number> {
  const names = ['body', 'content', 'text', 'msg', 'address', 'number', 'phone', 'date', 'time', 'type'];
  const out: Record<string, number> = {};
  for (const n of names) {
    const c = (xml.match(new RegExp(`\\b${n}\\s*=`, 'gi')) || []).length;
    if (c) out[n] = c;
  }
  return out;
}

/** 策略 A：标签属性（sms/item/message/msg/record/row） */
function strategyAttrTags(xml: string): ParsedBackupSms[] {
  const out: ParsedBackupSms[] = [];
  const re = /<(sms|item|message|msg|record|row)\b([\s\S]*?)(\/?)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tag = (m[1] || '').toLowerCase();
    const attrs = m[2] || '';
    const hasBody = /\b(body|content|text|msg|message)\s*=/i.test(attrs);
    // 容器根 <sms> 无正文属性
    if ((tag === 'sms' || tag === 'smses') && !hasBody) continue;
    const body = firstText(attrs, ['body', 'content', 'text', 'msg', 'message']);
    const address = firstText(attrs, ['address', 'number', 'phone', 'from', 'sender']);
    const msg = toMessage(
      {
        address,
        body,
        date: firstText(attrs, ['date', 'time', 'date_sent', 'timestamp']),
        type: firstText(attrs, ['type']),
        contactName: firstText(attrs, ['contact_name', 'person', 'name']),
      },
      `attr:${tag}`,
    );
    if (msg) out.push(msg);
  }
  return out;
}

/** 策略 B：DOMParser */
function strategyDom(xml: string): ParsedBackupSms[] {
  if (typeof DOMParser === 'undefined') return [];
  const out: ParsedBackupSms[] = [];
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const tags = ['sms', 'item', 'message', 'msg', 'record', 'row'];
    for (const tag of tags) {
      for (const el of Array.from(doc.getElementsByTagName(tag))) {
        const hasChildRecords = Array.from(el.children).some((c) =>
          /^(sms|item|message|msg|record|row)$/i.test(c.tagName),
        );
        const bodyAttr =
          el.getAttribute('body') ||
          el.getAttribute('content') ||
          el.getAttribute('text') ||
          el.getAttribute('msg');
        if (!bodyAttr && hasChildRecords) continue;
        const body = (bodyAttr || el.textContent || '').trim();
        if (!body || body.length > 20000) continue;
        const msg = toMessage(
          {
            address:
              el.getAttribute('address') ||
              el.getAttribute('number') ||
              el.getAttribute('phone') ||
              '',
            body,
            date: el.getAttribute('date') || el.getAttribute('time') || '',
            type: el.getAttribute('type') || '',
            contactName: el.getAttribute('contact_name') || el.getAttribute('person') || '',
          },
          `dom:${tag}`,
        );
        if (msg) out.push(msg);
      }
    }
  } catch {
    // ignore
  }
  return out;
}

/** 策略 C：成对标签 <item>...</item> 内找属性或文本 */
function strategyPairedTags(xml: string): ParsedBackupSms[] {
  const out: ParsedBackupSms[] = [];
  const re = /<(item|sms|message|msg|record)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[2] || '';
    const inner = m[3] || '';
    const body =
      firstText(attrs, ['body', 'content', 'text']) ||
      firstText(inner, ['body', 'content', 'text']) ||
      inner.replace(/<[^>]+>/g, '').trim();
    const address =
      firstText(attrs, ['address', 'number', 'phone']) ||
      firstText(inner, ['address', 'number', 'phone']);
    const msg = toMessage(
      {
        address,
        body,
        date: firstText(attrs, ['date', 'time']) || firstText(inner, ['date', 'time']),
        type: firstText(attrs, ['type']) || firstText(inner, ['type']),
      },
      `paired:${(m[1] || '').toLowerCase()}`,
    );
    if (msg) out.push(msg);
  }
  return out;
}

/** 策略 D：宽松正则抓 address=... body=... 邻近片段 */
function strategyLooseFields(xml: string): ParsedBackupSms[] {
  const out: ParsedBackupSms[] = [];
  const re =
    /address\s*=\s*["']([^"']+)["'][\s\S]{0,400}?body\s*=\s*["']([\s\S]*?)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const msg = toMessage(
      { address: decodeXmlEntities(m[1]), body: decodeXmlEntities(m[2]) },
      'loose:address-body',
    );
    if (msg) out.push(msg);
  }
  // body 在前 address 在后
  const re2 =
    /body\s*=\s*["']([\s\S]*?)["'][\s\S]{0,400}?address\s*=\s*["']([^"']+)["']/gi;
  while ((m = re2.exec(xml))) {
    const msg = toMessage(
      { address: decodeXmlEntities(m[2]), body: decodeXmlEntities(m[1]) },
      'loose:body-address',
    );
    if (msg) out.push(msg);
  }
  return out;
}

/** 策略 E：CSV（vivo 助手有时导 csv） */
function strategyCsv(text: string): ParsedBackupSms[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase();
  if (!/(address|号码|手机|body|内容|短信|date|时间)/.test(header)) return [];
  const cols = lines[0].split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
  const idx = (preds: RegExp[]) => cols.findIndex((c) => preds.some((p) => p.test(c)));
  const iAddr = idx([/address/i, /号码/, /手机/, /phone/i]);
  const iBody = idx([/body/i, /内容/, /短信/, /text/i]);
  const iDate = idx([/date/i, /时间/, /time/i]);
  if (iBody < 0) return [];
  const out: ParsedBackupSms[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    const msg = toMessage(
      {
        address: iAddr >= 0 ? parts[iAddr] : '',
        body: parts[iBody],
        date: iDate >= 0 ? parts[iDate] : '',
      },
      'csv',
    );
    if (msg) out.push(msg);
  }
  return out;
}

function dedupeMessages(list: ParsedBackupSms[]): ParsedBackupSms[] {
  const seen = new Set<string>();
  const out: ParsedBackupSms[] = [];
  for (const m of list) {
    const key = `${m.address}|${m.date}|${m.body.slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export function parseSmsXmlWithStrategies(xml: string): {
  messages: ParsedBackupSms[];
  strategies: Array<{ name: string; count: number; sample?: string }>;
} {
  const runs: Array<{ name: string; fn: () => ParsedBackupSms[] }> = [
    { name: 'A-标签属性(sms/item/…)', fn: () => strategyAttrTags(xml) },
    { name: 'B-DOMParser', fn: () => strategyDom(xml) },
    { name: 'C-成对标签', fn: () => strategyPairedTags(xml) },
    { name: 'D-宽松address/body', fn: () => strategyLooseFields(xml) },
    { name: 'E-CSV启发式', fn: () => strategyCsv(xml) },
  ];
  const strategies: Array<{ name: string; count: number; sample?: string }> = [];
  const merged: ParsedBackupSms[] = [];
  for (const r of runs) {
    let list: ParsedBackupSms[] = [];
    try {
      list = r.fn();
    } catch {
      list = [];
    }
    strategies.push({
      name: r.name,
      count: list.length,
      sample: list[0] ? `${list[0].address} | ${list[0].body.slice(0, 60)}` : undefined,
    });
    merged.push(...list);
  }
  return { messages: dedupeMessages(merged), strategies };
}

function magicHex(buf: Uint8Array, n = 8): string {
  return Array.from(buf.slice(0, n))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

function decodeTextBuffer(buf: Uint8Array): string {
  // UTF-16 LE BOM
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf);
  }
  // UTF-16 BE BOM
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf);
  }
  // UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3));
  }
  return new TextDecoder('utf-8').decode(buf);
}

function extractPayload(buf: Uint8Array): {
  kind: SmsParseReport['kind'];
  text: string;
  zipEntries: string[];
  chosenEntry?: string;
} {
  // ZIP
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
    const files = unzipSync(buf);
    const names = Object.keys(files);
    const prefer =
      names.find((n) => /(^|\/)message\.xml$/i.test(n)) ||
      names.find((n) => /\.xml$/i.test(n) && /sms|message|msg/i.test(n)) ||
      names.find((n) => /\.xml$/i.test(n)) ||
      names.find((n) => /\.(txt|csv)$/i.test(n)) ||
      names[0];
    if (!prefer) {
      return { kind: 'zip', text: '', zipEntries: names };
    }
    return {
      kind: 'zip',
      text: strFromU8(files[prefer]),
      zipEntries: names,
      chosenEntry: prefer,
    };
  }
  // GZIP
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    const inflated = gunzipSync(buf);
    return { kind: 'gzip', text: decodeTextBuffer(inflated), zipEntries: [] };
  }
  const text = decodeTextBuffer(buf);
  const kind = /<sms|<item|<smses|<message/i.test(text) ? 'xml' : 'text';
  return { kind, text, zipEntries: [] };
}

export function parseSmsBackupBuffer(
  buf: Uint8Array,
  fileName = 'backup.sms',
): { messages: ParsedBackupSms[]; report: SmsParseReport } {
  const report: SmsParseReport = {
    fileName,
    byteLength: buf.byteLength,
    magicHex: magicHex(buf),
    kind: 'unknown',
    zipEntries: [],
    xmlHead: '',
    xmlTail: '',
    tagCounts: {},
    attrCounts: {},
    strategies: [],
    parseCount: 0,
    ledgerCount: 0,
  };

  try {
    const payload = extractPayload(buf);
    report.kind = payload.kind;
    report.zipEntries = payload.zipEntries;
    report.chosenEntry = payload.chosenEntry;
    const text = payload.text || '';
    report.xmlHead = text.slice(0, 500).replace(/\r/g, '');
    report.xmlTail = text.slice(Math.max(0, text.length - 300)).replace(/\r/g, '');
    report.tagCounts = countTags(text);
    report.attrCounts = countAttrs(text);
    report.rawTextPreview = text.slice(0, 800);

    if (!text.trim()) {
      report.error = '解压/解码后内容为空';
      return { messages: [], report };
    }

    const { messages, strategies } = parseSmsXmlWithStrategies(text);
    report.strategies = strategies;
    report.parseCount = messages.length;
    report.ledgerCount = messages.filter((m) => m.ledgerLike).length;
    if (messages.length === 0) {
      report.error = '多种策略均未解析出短信记录';
    }
    return { messages, report };
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
    return { messages: [], report };
  }
}

export function formatSmsParseReport(report: SmsParseReport): string {
  const lines = [
    '=== 短信备份解析报告（请整段复制发给开发） ===',
    `文件名: ${report.fileName}`,
    `字节数: ${report.byteLength}`,
    `文件头(hex): ${report.magicHex}`,
    `识别类型: ${report.kind}`,
    report.zipEntries.length
      ? `ZIP条目: ${report.zipEntries.slice(0, 30).join(' | ')}`
      : 'ZIP条目: (无)',
    report.chosenEntry ? `选用条目: ${report.chosenEntry}` : '',
    `标签统计: ${JSON.stringify(report.tagCounts)}`,
    `属性统计: ${JSON.stringify(report.attrCounts)}`,
    `策略结果:`,
    ...report.strategies.map(
      (s) => `  - ${s.name}: ${s.count} 条${s.sample ? ` | 样例: ${s.sample}` : ''}`,
    ),
    `最终解析条数: ${report.parseCount}`,
    `疑似动账: ${report.ledgerCount}`,
    report.error ? `错误: ${report.error}` : '错误: (无)',
    '--- 文件开头 500 字 ---',
    report.xmlHead || '(空)',
    '--- 文件结尾 300 字 ---',
    report.xmlTail || '(空)',
    '=== 报告结束 ===',
  ];
  return lines.filter(Boolean).join('\n');
}

export function buildSmsBackupPreview(
  messages: ParsedBackupSms[],
  fileName: string,
  report: SmsParseReport,
): SmsBackupPreview {
  const sorted = [...messages].sort((a, b) => b.date - a.date);
  const byAddr = new Map<string, ParsedBackupSms[]>();
  for (const m of sorted) {
    const key = m.address || '(空地址)';
    const list = byAddr.get(key) ?? [];
    list.push(m);
    byAddr.set(key, list);
  }
  const groups: SmsAddressGroup[] = [...byAddr.entries()]
    .map(([address, msgs]) => ({
      address,
      contactName: msgs.find((x) => x.contactName)?.contactName,
      total: msgs.length,
      ledgerCount: msgs.filter((x) => x.ledgerLike).length,
      messages: msgs,
    }))
    .sort((a, b) => b.ledgerCount - a.ledgerCount || b.total - a.total);

  const ledgerCount = sorted.filter((m) => m.ledgerLike).length;
  return {
    fileName,
    total: sorted.length,
    ledgerCount,
    otherCount: sorted.length - ledgerCount,
    groups,
    messages: sorted,
    report,
    debug: formatSmsParseReport(report).slice(0, 400),
  };
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function readPickedFileBuffer(picked: PickedFile): Promise<ArrayBuffer> {
  if (picked.data) return base64ToArrayBuffer(picked.data);
  if (picked.blob) return picked.blob.arrayBuffer();
  if (picked.path) {
    const url = Capacitor.convertFileSrc(picked.path);
    const response = await fetch(url);
    if (!response.ok) throw new Error('无法读取所选文件');
    return response.arrayBuffer();
  }
  throw new Error('无法读取文件内容');
}

function pickedFileName(picked: PickedFile): string {
  return picked.name || picked.path?.split('/').pop() || 'backup.sms';
}

/**
 * 选文件并解析。即使 0 条也会返回带完整 report 的 preview，方便复制诊断。
 */
export async function pickAndPreviewSmsBackup(webFile?: File): Promise<SmsBackupPreview> {
  let fileName = 'backup.sms';
  let buffer: ArrayBuffer;

  if (Capacitor.isNativePlatform()) {
    const result = await FilePicker.pickFiles({
      limit: 1,
      readData: true,
      types: [
        'application/octet-stream',
        'application/zip',
        'application/x-zip-compressed',
        'text/xml',
        'application/xml',
        '*/*',
      ],
    });
    const picked = result.files?.[0];
    if (!picked) throw new Error('未选择文件');
    fileName = pickedFileName(picked);
    buffer = await readPickedFileBuffer(picked);
  } else {
    if (!webFile) throw new Error('未选择文件');
    fileName = webFile.name;
    buffer = await webFile.arrayBuffer();
  }

  const { messages, report } = parseSmsBackupBuffer(new Uint8Array(buffer), fileName);
  return buildSmsBackupPreview(messages, fileName, report);
}

export async function importPreviewMessages(
  preview: SmsBackupPreview,
  options?: { addressFilter?: string; ledgerOnly?: boolean },
): Promise<{ matched: number; results: IngestResult[] }> {
  const addressFilter = options?.addressFilter?.trim();
  const ledgerOnly = options?.ledgerOnly !== false;

  let filtered = preview.messages.filter((m) => m.type == null || m.type === 1 || Number.isNaN(m.type));
  if (addressFilter) {
    filtered = filtered.filter(
      (m) => addressMatches(m.address, addressFilter) || m.body.includes(addressFilter),
    );
  }
  if (ledgerOnly) {
    filtered = filtered.filter((m) => m.ledgerLike);
  }

  const results = await ingestMany(
    filtered.map((m, i) => ({
      channel: 'sms' as const,
      packageOrAddress: m.address || addressFilter || 'sms-backup',
      title: m.contactName || addressFilter || '短信备份',
      body: m.body,
      occurredAt: m.date,
      nativeId: `backup_${m.date}_${i}_${(m.address || '').slice(-8)}`,
      meta: {
        via: 'sms-backup-file',
        fileName: preview.fileName,
        discoveredAddress: m.address || '',
      },
    })),
  );

  return { matched: filtered.length, results };
}
