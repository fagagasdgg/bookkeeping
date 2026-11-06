import { normalizePhone } from '../lib/hash';
import { deleteSmsFilter, listSmsFilters, putSmsFilter } from './db';
import { emitDataChange } from './events';
import { ingestMany } from './ingest';
import { probeSmsSenders, queryInboxSms, type NativeSmsMessage, type SmsSenderSample } from '../plugins/smsReader';
import type { IngestResult, SmsSourceFilter } from './types';

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

export function matchSmsAgainstFilter(sms: NativeSmsMessage, filter: SmsSourceFilter): boolean {
  const blob = `${sms.address}\n${sms.body}\n${sms.person || ''}`.toLowerCase();

  const addressMatched = filter.address ? addressMatches(sms.address || '', filter.address) : false;
  // Also treat the configured number appearing in body as a hit (some OEM rewrite ADDRESS).
  const addressInBody =
    !!filter.address && (sms.body || '').includes(filter.address);

  const keywords = filterKeywords(filter);
  const keywordMatched = keywords.some((k) => blob.includes(k.toLowerCase()));

  if (filter.address && keywords.length > 0) {
    return addressMatched || addressInBody || keywordMatched;
  }
  if (filter.address) return addressMatched || addressInBody;
  if (keywords.length > 0) return keywordMatched;
  return false;
}

export async function scanSmsByFilter(filter: SmsSourceFilter): Promise<{
  matched: number;
  results: IngestResult[];
  scanned: number;
  sampleAddresses: string[];
}> {
  const keywords = filterKeywords(filter);

  // Always include address in the native query when present.
  // Also pass a keyword so SQL OR can catch OEM-rewritten sender numbers.
  const messages = await queryInboxSms({
    address: filter.address,
    bodyContains: keywords[0],
    limit: 2000,
  });

  const matched = messages.filter((m) => matchSmsAgainstFilter(m, filter));
  const sampleAddresses = [...new Set(messages.map((m) => m.address).filter(Boolean))].slice(0, 8);

  const results = await ingestMany(
    matched.map((m) => ({
      channel: 'sms' as const,
      packageOrAddress: m.address,
      title: filter.label,
      body: m.body,
      occurredAt: m.date,
      nativeId: String(m.id),
      meta: { filterId: filter.id },
    })),
  );
  return { matched: matched.length, results, scanned: messages.length, sampleAddresses };
}

export async function probeFilterSenders(filter: SmsSourceFilter): Promise<SmsSenderSample[]> {
  const needle = filter.address || filter.remark || filter.label || '';
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
