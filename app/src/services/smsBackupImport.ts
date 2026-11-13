import { Capacitor } from '@capacitor/core';
import { FilePicker, type PickedFile } from '@capawesome/capacitor-file-picker';
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
  /** 启发式：是否像动账 */
  ledgerLike: boolean;
}

export interface SmsAddressGroup {
  address: string;
  contactName?: string;
  total: number;
  ledgerCount: number;
  messages: ParsedBackupSms[];
}

export interface SmsBackupPreview {
  fileName: string;
  total: number;
  ledgerCount: number;
  otherCount: number;
  groups: SmsAddressGroup[];
  messages: ParsedBackupSms[];
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
      address: address || '(空地址)',
      body,
      date: Number.isFinite(date) && date > 0 ? date : Date.now(),
      type: typeRaw ? Number(typeRaw) : undefined,
      contactName: attr(attrs, 'contact_name') || undefined,
      ledgerLike: bodyLooksLikeLedgerSms(body),
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

export function parseSmsBackupBuffer(buf: Uint8Array, fileName = 'backup.sms'): ParsedBackupSms[] {
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
    return parseSmsXml(extractXmlFromZip(buf));
  }
  const text = new TextDecoder('utf-8').decode(buf);
  if (looksLikeXml(text)) return parseSmsXml(text);
  throw new Error(
    `无法识别「${fileName}」。请使用 vivo/iQOO 导出的 .sms，或 SMS Backup & Restore 的 .xml`,
  );
}

export function buildSmsBackupPreview(
  messages: ParsedBackupSms[],
  fileName: string,
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
  };
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** 对齐 read：优先 data，其次 blob，再 convertFileSrc + fetch */
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
 * 选文件并解析成预览（不入库）。
 * 真机：@capawesome/capacitor-file-picker（SAF）；浏览器：传入 File。
 */
export async function pickAndPreviewSmsBackup(webFile?: File): Promise<SmsBackupPreview> {
  if (Capacitor.isNativePlatform()) {
    const result = await FilePicker.pickFiles({
      limit: 1,
      readData: true,
      // .sms 常被标成 octet-stream / zip
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
    const fileName = pickedFileName(picked);
    const buffer = await readPickedFileBuffer(picked);
    const messages = parseSmsBackupBuffer(new Uint8Array(buffer), fileName);
    if (messages.length === 0) throw new Error('文件里没有解析到短信记录');
    return buildSmsBackupPreview(messages, fileName);
  }

  if (!webFile) throw new Error('未选择文件');
  const buffer = await webFile.arrayBuffer();
  const messages = parseSmsBackupBuffer(new Uint8Array(buffer), webFile.name);
  if (messages.length === 0) throw new Error('文件里没有解析到短信记录');
  return buildSmsBackupPreview(messages, webFile.name);
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
