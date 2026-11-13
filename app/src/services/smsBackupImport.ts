import { unzipSync, strFromU8 } from 'fflate';
import { ingestMany } from './ingest';
import { addressMatches, bodyLooksLikeLedgerSms } from './smsFilters';
import type { IngestResult } from './types';

export interface ParsedBackupSms {
  address: string;
  body: string;
  date: number;
  type?: number;
  contactName?: string;
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

function attr(tag: string, name: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i');
  const m = tag.match(re);
  if (m) return decodeXmlEntities(m[1]);
  const re2 = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i');
  const m2 = tag.match(re2);
  return m2 ? decodeXmlEntities(m2[1]) : '';
}

/** Parse SMS Backup & Restore / vivo message.xml style content. */
export function parseSmsXml(xml: string): ParsedBackupSms[] {
  const out: ParsedBackupSms[] = [];
  // Self-closing <sms ... /> or <sms ...></sms>
  const re = /<sms\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1] || '';
    const body = attr(attrs, 'body');
    const address = attr(attrs, 'address');
    const dateRaw = attr(attrs, 'date');
    const typeRaw = attr(attrs, 'type');
    const date = Number(dateRaw);
    if (!body) continue;
    out.push({
      address: address || '',
      body,
      date: Number.isFinite(date) && date > 0 ? date : Date.now(),
      type: typeRaw ? Number(typeRaw) : undefined,
      contactName: attr(attrs, 'contact_name') || undefined,
    });
  }
  return out;
}

function looksLikeXml(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('<?xml') || t.startsWith('<smses') || t.startsWith('<Smses') || t.includes('<sms');
}

function extractXmlFromZip(buf: Uint8Array): string {
  const files = unzipSync(buf);
  const names = Object.keys(files);
  const prefer =
    names.find((n) => /message\.xml$/i.test(n)) ||
    names.find((n) => /\.xml$/i.test(n) && /sms|message/i.test(n)) ||
    names.find((n) => /\.xml$/i.test(n));
  if (!prefer) {
    throw new Error('压缩包内未找到 message.xml，请确认是 vivo/iQOO 导出的 .sms 文件');
  }
  return strFromU8(files[prefer]);
}

/** Read .sms (zip) / .xml / plain xml text into message list. */
export async function parseSmsBackupFile(file: File): Promise<ParsedBackupSms[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  // ZIP magic PK
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
    const xml = extractXmlFromZip(buf);
    return parseSmsXml(xml);
  }
  const text = new TextDecoder('utf-8').decode(buf);
  if (looksLikeXml(text)) return parseSmsXml(text);
  throw new Error('无法识别该文件。请使用 vivo/iQOO 导出的 .sms，或 SMS Backup & Restore 的 .xml');
}

export async function importSmsBackupFile(
  file: File,
  options?: { addressFilter?: string; ledgerOnly?: boolean },
): Promise<{
  total: number;
  matched: number;
  results: IngestResult[];
  sampleAddresses: string[];
}> {
  const all = await parseSmsBackupFile(file);
  const addressFilter = options?.addressFilter?.trim();
  const ledgerOnly = options?.ledgerOnly !== false;

  let filtered = all;
  // Prefer inbox (type=1); keep unknown type
  filtered = filtered.filter((m) => m.type == null || m.type === 1 || Number.isNaN(m.type));

  if (addressFilter) {
    filtered = filtered.filter(
      (m) => addressMatches(m.address, addressFilter) || m.body.includes(addressFilter),
    );
  }
  if (ledgerOnly) {
    filtered = filtered.filter((m) => bodyLooksLikeLedgerSms(m.body));
  }

  const sampleAddresses = [...new Set(all.map((m) => m.address).filter(Boolean))].slice(0, 12);

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
        fileName: file.name,
        discoveredAddress: m.address || '',
      },
    })),
  );

  return {
    total: all.length,
    matched: filtered.length,
    results,
    sampleAddresses,
  };
}
