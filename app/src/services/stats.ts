import { periodRange } from '../lib/time';
import { listSourcesByTxn, listTransactions } from './db';
import type { Channel, PeriodKind, PeriodSummary, Transaction } from './types';

function isCountable(txn: Transaction): boolean {
  return txn.status !== 'parse_failed' && txn.amountCents > 0;
}

export async function summarizePeriod(kind: PeriodKind, anchor: number): Promise<PeriodSummary> {
  const { start, end } = periodRange(kind, anchor);
  const all = (await listTransactions()).filter(
    (t) => isCountable(t) && t.occurredAt >= start && t.occurredAt <= end,
  );

  let expenseCents = 0;
  let incomeCents = 0;
  const catMap = new Map<string, { expenseCents: number; incomeCents: number }>();
  const channelMap = new Map<Channel, { expenseCents: number; incomeCents: number }>();

  for (const txn of all) {
    if (txn.direction === 'expense') expenseCents += txn.amountCents;
    else incomeCents += txn.amountCents;

    const cat = catMap.get(txn.category) ?? { expenseCents: 0, incomeCents: 0 };
    if (txn.direction === 'expense') cat.expenseCents += txn.amountCents;
    else cat.incomeCents += txn.amountCents;
    catMap.set(txn.category, cat);

    // Channel share: use primaryChannel; if multiple sources, still count once on primary
    const ch = channelMap.get(txn.primaryChannel) ?? { expenseCents: 0, incomeCents: 0 };
    if (txn.direction === 'expense') ch.expenseCents += txn.amountCents;
    else ch.incomeCents += txn.amountCents;
    channelMap.set(txn.primaryChannel, ch);
  }

  return {
    expenseCents,
    incomeCents,
    balanceCents: incomeCents - expenseCents,
    byCategory: [...catMap.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.expenseCents - a.expenseCents),
    byChannel: [...channelMap.entries()]
      .map(([channel, v]) => ({ channel, ...v }))
      .sort((a, b) => b.expenseCents - a.expenseCents),
  };
}

export async function searchTransactions(query: string): Promise<Transaction[]> {
  const q = query.trim().toLowerCase();
  const all = await listTransactions();
  if (!q) return all.filter(isCountable);
  const out: Transaction[] = [];
  for (const txn of all) {
    if (!isCountable(txn) && txn.status !== 'parse_failed') continue;
    const sources = await listSourcesByTxn(txn.id);
    const blob = [
      txn.merchant,
      txn.category,
      txn.note ?? '',
      ...sources.map((s) => `${s.title ?? ''} ${s.rawBody} ${s.packageOrAddress}`),
    ]
      .join('\n')
      .toLowerCase();
    if (blob.includes(q)) out.push(txn);
  }
  return out;
}
