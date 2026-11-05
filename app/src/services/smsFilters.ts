import { normalizePhone } from '../lib/hash';
import { deleteSmsFilter, listSmsFilters, putSmsFilter } from './db';
import { emitDataChange } from './events';
import { ingestMany } from './ingest';
import { queryInboxSms, type NativeSmsMessage } from '../plugins/smsReader';
import type { IngestResult, SmsSourceFilter } from './types';

export async function addSmsFilter(input: {
  label: string;
  address?: string;
  remark?: string;
}): Promise<SmsSourceFilter> {
  const address = input.address?.trim();
  const remark = input.remark?.trim();
  if (!address && !remark) {
    throw new Error('请至少填写号码或备注');
  }
  const filter: SmsSourceFilter = {
    id: `smsf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    label: input.label.trim() || remark || address || '未命名来源',
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

export function matchSmsAgainstFilter(sms: NativeSmsMessage, filter: SmsSourceFilter): boolean {
  const addr = normalizePhone(sms.address || '');
  if (filter.address) {
    const want = normalizePhone(filter.address);
    if (want && (addr === want || addr.endsWith(want) || want.endsWith(addr))) {
      return true;
    }
  }
  if (filter.remark) {
    const remark = filter.remark.toLowerCase();
    const blob = `${sms.address}\n${sms.body}\n${sms.person || ''}`.toLowerCase();
    if (blob.includes(remark)) return true;
  }
  // If only address was provided and didn't match, fail; if only remark, already checked
  if (filter.address && !filter.remark) return false;
  if (!filter.address && filter.remark) return false;
  return false;
}

export async function scanSmsByFilter(filter: SmsSourceFilter): Promise<{
  matched: number;
  results: IngestResult[];
}> {
  const messages = await queryInboxSms({
    address: filter.address,
    bodyContains: filter.remark,
    limit: 500,
  });
  const matched = messages.filter((m) => matchSmsAgainstFilter(m, filter));
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
  return { matched: matched.length, results };
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
