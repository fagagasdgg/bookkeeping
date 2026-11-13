import { normalizePhone } from '../lib/hash';
import { deleteSmsFilter, listSmsFilters, putSmsFilter } from './db';
import { emitDataChange } from './events';
import { ingestMany } from './ingest';
import { querySmsBySender, type NativeSmsMessage } from '../plugins/smsReader';
import type { IngestResult, SmsSourceFilter } from './types';

export async function addSmsFilter(input: {
  address: string;
  label?: string;
}): Promise<SmsSourceFilter> {
  const address = input.address.trim();
  if (!address) throw new Error('请填写发件号码，如 95588');
  const filter: SmsSourceFilter = {
    id: `smsf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    label: (input.label?.trim() || address),
    address,
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

/** 正文是否像动账短信 */
export function bodyLooksLikeLedgerSms(body: string): boolean {
  const text = body || '';
  const hasAmount =
    /\d+(?:\.\d{1,2})?\s*元/.test(text) ||
    /(?:￥|¥)\s*\d/.test(text) ||
    /(?:支出|收入|消费|支付)\s*[(（][^)）]{0,60}[)）]\s*\d/.test(text);
  if (!hasAmount) return false;
  return /(支出|收入|消费|支付|入账|扣款|尾号|余额|转账|银行|支付宝|微信|财付通)/.test(text);
}

/**
 * 只填号码：按发件人拉会话，自动筛动账并入库。
 */
export async function scanSmsByAddress(address: string, label?: string): Promise<{
  scanned: number;
  matched: number;
  results: IngestResult[];
  discoveredSenders: string[];
}> {
  const needle = address.trim();
  if (!needle) throw new Error('请填写发件号码');

  const { messages, discoveredAddresses } = await querySmsBySender(needle, 5000);
  // 号码已定位会话；会话内再自动筛动账正文
  const ledger = messages.filter((m) => bodyLooksLikeLedgerSms(m.body || ''));

  const results = await ingestMany(
    ledger.map((m: NativeSmsMessage) => ({
      channel: 'sms' as const,
      packageOrAddress: m.address || needle,
      title: label || needle,
      body: m.body,
      occurredAt: m.date,
      nativeId: String(m.id),
      meta: {
        via: 'sms-address-scan',
        configuredAddress: needle,
        discoveredAddress: m.address || '',
      },
    })),
  );

  return {
    scanned: messages.length,
    matched: ledger.length,
    results,
    discoveredSenders: discoveredAddresses.length
      ? discoveredAddresses
      : [...new Set(ledger.map((m) => m.address || '(空地址)'))],
  };
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
    if (!filter.address) continue;
    const { matched, results } = await scanSmsByAddress(filter.address, filter.label);
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
