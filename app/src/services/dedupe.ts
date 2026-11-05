import { hashText, normalizePhone } from '../lib/hash';
import { looksLikePaymentChannelSms } from './parse';
import type {
  ParsedCandidate,
  RawCapture,
  Transaction,
  TransactionSource,
} from './types';

export const DEFAULT_MERGE_WINDOW_MS = 5 * 60 * 1000;

export function buildFingerprint(raw: RawCapture): string {
  if (raw.channel === 'sms') {
    const addr = normalizePhone(raw.packageOrAddress);
    const native = raw.nativeId ? `id:${raw.nativeId}` : `d:${raw.occurredAt}:${hashText(raw.body)}`;
    return `sms:${addr}:${native}`;
  }
  const pkg = raw.packageOrAddress || 'unknown';
  const title = raw.title ?? '';
  return `notify:${pkg}:${raw.occurredAt}:${hashText(`${title}\n${raw.body}`)}`;
}

function merchantOverlap(a: string, b: string): boolean {
  const x = a.replace(/\s/g, '');
  const y = b.replace(/\s/g, '');
  if (!x || !y || x === '未知商户' || y === '未知商户') return false;
  return x.includes(y) || y.includes(x);
}

function channelRank(channel: Transaction['primaryChannel'], body: string): number {
  if (channel === 'notify') return 3;
  if (looksLikePaymentChannelSms(body)) return 2;
  return 1;
}

export type MatchDecision =
  | { kind: 'none' }
  | { kind: 'merge'; txn: Transaction; reason: string }
  | { kind: 'suspect'; txn: Transaction; reason: string };

export function matchExistingTransaction(args: {
  parsed: ParsedCandidate;
  fingerprint: string;
  raw: RawCapture;
  transactions: Transaction[];
  sourcesByTxn: Map<string, TransactionSource[]>;
  negativePairs: Set<string>;
  windowMs?: number;
}): MatchDecision {
  const windowMs = args.windowMs ?? DEFAULT_MERGE_WINDOW_MS;
  const { parsed, fingerprint, raw, transactions, sourcesByTxn, negativePairs } = args;

  let bestSuspect: { txn: Transaction; score: number; reason: string } | null = null;

  for (const txn of transactions) {
    if (txn.amountCents !== parsed.amountCents) continue;
    if (txn.direction !== parsed.direction) continue;
    const dt = Math.abs(txn.occurredAt - parsed.occurredAt);
    if (dt > windowMs) continue;

    const sources = sourcesByTxn.get(txn.id) ?? [];
    for (const src of sources) {
      const pairKey = [fingerprint, src.fingerprint].sort().join('|');
      if (negativePairs.has(pairKey)) continue;
    }

    const strongSignals: string[] = [];
    if (parsed.payChannelHint || looksLikePaymentChannelSms(raw.body)) {
      strongSignals.push('pay-channel-hint');
    }
    if (parsed.cardLast4) {
      const hit = sources.some((s) => (s.meta?.cardLast4 ?? '') === parsed.cardLast4);
      if (hit) strongSignals.push('card-last4');
    }
    if (merchantOverlap(parsed.merchant, txn.merchant)) {
      strongSignals.push('merchant');
    }
    // Cross-channel preference: notify <-> sms
    const crossChannel = sources.some((s) => s.channel !== raw.channel);
    if (crossChannel) strongSignals.push('cross-channel');

    if (strongSignals.length >= 1 && (crossChannel || strongSignals.includes('pay-channel-hint'))) {
      return {
        kind: 'merge',
        txn,
        reason: strongSignals.join(','),
      };
    }

    const score = strongSignals.length + (windowMs - dt) / windowMs;
    if (!bestSuspect || score > bestSuspect.score) {
      bestSuspect = {
        txn,
        score,
        reason: strongSignals.length ? strongSignals.join(',') : 'amount+time',
      };
    }
  }

  if (bestSuspect) {
    return { kind: 'suspect', txn: bestSuspect.txn, reason: bestSuspect.reason };
  }
  return { kind: 'none' };
}

export function pickPrimaryChannel(
  existing: Transaction,
  existingSources: TransactionSource[],
  incomingChannel: Transaction['primaryChannel'],
  incomingBody: string,
): Transaction['primaryChannel'] {
  const currentBest = Math.max(
    0,
    ...existingSources.map((s) => channelRank(s.channel, s.rawBody)),
    channelRank(existing.primaryChannel, ''),
  );
  const incoming = channelRank(incomingChannel, incomingBody);
  return incoming > currentBest ? incomingChannel : existing.primaryChannel;
}

export function negativePairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}
