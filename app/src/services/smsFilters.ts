import { normalizePhone } from '../lib/hash';
import { deleteSmsFilter, listSmsFilters, putSmsFilter } from './db';
import { emitDataChange } from './events';
import { ingestMany } from './ingest';
import {
  probeSmsSenders,
  queryInboxSms,
  queryRecentSms,
  type NativeSmsMessage,
  type SmsSenderSample,
} from '../plugins/smsReader';
import type { IngestResult, SmsSourceFilter } from './types';

/** 动账短信正文常见关键字（不依赖发件人号码） */
export const BANK_BODY_KEYWORDS = [
  '工商银行',
  '建设银行',
  '农业银行',
  '中国银行',
  '招商银行',
  '交通银行',
  '邮储银行',
  '财付通',
  '支付宝',
  '微信支付',
  '尾号',
  '支出',
  '收入',
  '入账',
  '扣款',
];

export async function addSmsFilter(input: {
  label: string;
  address?: string;
  remark?: string;
}): Promise<SmsSourceFilter> {
  const address = input.address?.trim();
  const remark = input.remark?.trim();
  const label = input.label.trim();
  if (!address && !remark && !label) {
    throw new Error('请至少填写显示名称、号码或备注之一');
  }
  const filter: SmsSourceFilter = {
    id: `smsf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    label: label || remark || address || '未命名来源',
    address: address || undefined,
    remark: remark || undefined,
    createdAt: Date.now(),
  };
  await putSmsFilter(filter);
  emitDataChange();
  return filter;
}

export async function removeSmsFilter(id: string): Promise<void> {
  await deleteSmsFilter(id);
  emitDataChange();
}

export async function getSmsFilters(): Promise<SmsSourceFilter[]> {
  return listSmsFilters();
}

/** Keywords used for body matching: remark first, then display label. */
export function filterKeywords(filter: SmsSourceFilter): string[] {
  const keys = [filter.remark, filter.label]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s && s.length > 0);
  return [...new Set(keys)];
}

export function addressMatches(smsAddress: string, wantRaw: string): boolean {
  const want = normalizePhone(wantRaw);
  const have = normalizePhone(smsAddress || '');
  if (!want) return false;
  return (
    have === want ||
    have.includes(want) ||
    want.includes(have) ||
    (smsAddress || '').includes(wantRaw)
  );
}

export function bodyLooksLikeLedgerSms(body: string): boolean {
  const text = body || '';
  if (!/(元|￥|¥)/.test(text)) return false;
  const hitKeyword = BANK_BODY_KEYWORDS.some((k) => text.includes(k));
  const hitAmount = /\d+(?:\.\d{1,2})?\s*元/.test(text) || /(?:￥|¥)\s*\d/.test(text);
  return hitKeyword && hitAmount;
}

export function matchSmsAgainstFilter(sms: NativeSmsMessage, filter: SmsSourceFilter): boolean {
  const body = sms.body || '';
  const blob = `${sms.address}\n${body}\n${sms.person || ''}`.toLowerCase();

  // Body-first: if configured keywords hit the body, accept regardless of address quirks.
  const keywords = filterKeywords(filter);
  if (keywords.some((k) => body.toLowerCase().includes(k.toLowerCase()))) {
    return true;
  }
  // Generic ledger body for filters that look like bank names
  if (keywords.some((k) => /银行|工商|建设|农业|招商|交通|邮储/.test(k)) && bodyLooksLikeLedgerSms(body)) {
    return true;
  }

  const addressMatched = filter.address ? addressMatches(sms.address || '', filter.address) : false;
  const addressInBody = !!filter.address && body.includes(filter.address);
  const keywordInBlob = keywords.some((k) => blob.includes(k.toLowerCase()));

  if (filter.address && keywords.length > 0) {
    return addressMatched || addressInBody || keywordInBlob;
  }
  if (filter.address) return addressMatched || addressInBody;
  if (keywords.length > 0) return keywordInBlob;
  return false;
}

export async function scanSmsByFilter(filter: SmsSourceFilter): Promise<{
  matched: number;
  results: IngestResult[];
  scanned: number;
  sampleAddresses: string[];
  discoveredSenders: string[];
}> {
  const keywords = filterKeywords(filter);

  // Body-first query: do NOT require address at native layer.
  // Walk recent messages and match by body keywords / ledger heuristics.
  let messages: NativeSmsMessage[];
  if (keywords.length > 0) {
    // Prefer keyword SQL for speed; also pull recent unfiltered as backup merge.
    const byKeyword = await queryInboxSms({
      bodyContains: keywords[0],
      limit: 2000,
    });
    const recent = await queryRecentSms(400);
    const map = new Map<number, NativeSmsMessage>();
    for (const m of [...byKeyword, ...recent]) map.set(m.id, m);
    messages = [...map.values()];
  } else if (filter.address) {
    messages = await queryInboxSms({ address: filter.address, limit: 2000 });
  } else {
    messages = await queryRecentSms(400);
  }

  const matched = messages.filter((m) => matchSmsAgainstFilter(m, filter));
  const sampleAddresses = [...new Set(messages.map((m) => m.address).filter(Boolean))].slice(0, 8);
  const discoveredSenders = [...new Set(matched.map((m) => m.address || '(空地址)'))].slice(0, 12);

  const results = await ingestMany(
    matched.map((m) => ({
      channel: 'sms' as const,
      packageOrAddress: m.address,
      title: filter.label,
      body: m.body,
      occurredAt: m.date,
      nativeId: String(m.id),
      meta: {
        filterId: filter.id,
        discoveredAddress: m.address || '',
      },
    })),
  );
  return {
    matched: matched.length,
    results,
    scanned: messages.length,
    sampleAddresses,
    discoveredSenders,
  };
}

/**
 * 不依赖发件人：遍历最新短信，用正文关键字找动账，并回报真实发件号。
 */
export async function scanRecentByBodyKeywords(options?: {
  limit?: number;
  extraKeywords?: string[];
}): Promise<{
  scanned: number;
  matched: number;
  results: IngestResult[];
  hits: Array<{ address: string; preview: string; date: number }>;
  discoveredSenders: string[];
}> {
  const limit = options?.limit ?? 400;
  const extra = (options?.extraKeywords ?? []).map((s) => s.trim()).filter(Boolean);
  const keywords = [...new Set([...extra, ...BANK_BODY_KEYWORDS])];

  const recent = await queryRecentSms(limit);
  const matchedMsgs = recent.filter((m) => {
    const body = m.body || '';
    if (!bodyLooksLikeLedgerSms(body)) return false;
    // Prefer bank-ish keywords; amount already required in bodyLooksLikeLedgerSms
    return keywords.some((k) => body.includes(k)) || /【.+银行】/.test(body);
  });

  const hits = matchedMsgs.slice(0, 20).map((m) => ({
    address: m.address || '(空地址)',
    preview: (m.body || '').slice(0, 80),
    date: m.date,
  }));
  const discoveredSenders = [...new Set(matchedMsgs.map((m) => m.address || '(空地址)'))];

  const results = await ingestMany(
    matchedMsgs.map((m) => ({
      channel: 'sms' as const,
      packageOrAddress: m.address,
      title: '正文扫描',
      body: m.body,
      occurredAt: m.date,
      nativeId: String(m.id),
      meta: {
        via: 'body-keyword-scan',
        discoveredAddress: m.address || '',
      },
    })),
  );

  return {
    scanned: recent.length,
    matched: matchedMsgs.length,
    results,
    hits,
    discoveredSenders,
  };
}

export async function probeFilterSenders(filter: SmsSourceFilter): Promise<SmsSenderSample[]> {
  const needle = filter.remark || filter.label || filter.address || '';
  // Prefer body/label needle so we don't miss OEM-rewritten addresses
  return probeSmsSenders({ limit: 40, needle });
}

export async function scanAllSmsFilters(): Promise<{
  matched: number;
  created: number;
  merged: number;
  duplicate: number;
  queued: number;
  failed: number;
}> {
  const filters = await listSmsFilters();
  const summary = {
    matched: 0,
    created: 0,
    merged: 0,
    duplicate: 0,
    queued: 0,
    failed: 0,
  };
  for (const filter of filters) {
    const { matched, results } = await scanSmsByFilter(filter);
    summary.matched += matched;
    for (const r of results) {
      if (r.action === 'created') summary.created += 1;
      else if (r.action === 'merged') summary.merged += 1;
      else if (r.action === 'duplicate') summary.duplicate += 1;
      else if (r.action === 'queued_review') summary.queued += 1;
      else if (r.action === 'parse_failed') summary.failed += 1;
    }
  }
  return summary;
}
