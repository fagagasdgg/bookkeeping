import { classifyMerchant } from './classify';
import {
  getSourceByFingerprint,
  listNegativePairs,
  listSourcesByTxn,
  listTransactions,
  putReview,
  putSource,
  putTransaction,
} from './db';
import {
  buildFingerprint,
  matchExistingTransaction,
  negativePairKey,
  pickPrimaryChannel,
} from './dedupe';
import { emitDataChange } from './events';
import { parseCapture } from './parse';
import type {
  IngestResult,
  RawCapture,
  ReviewItem,
  Transaction,
  TransactionSource,
} from './types';

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function loadMatchContext() {
  const transactions = await listTransactions();
  const sourcesByTxn = new Map<string, TransactionSource[]>();
  for (const txn of transactions) {
    sourcesByTxn.set(txn.id, await listSourcesByTxn(txn.id));
  }
  const negativePairs = new Set(
    (await listNegativePairs()).map((p) => negativePairKey(p.fingerprintA, p.fingerprintB)),
  );
  return { transactions, sourcesByTxn, negativePairs };
}

export async function ingestCapture(raw: RawCapture): Promise<IngestResult> {
  const fingerprint = buildFingerprint(raw);
  const existingSource = await getSourceByFingerprint(fingerprint);
  if (existingSource) {
    return { action: 'duplicate', fingerprint, transactionId: existingSource.transactionId };
  }

  const parsed = parseCapture(raw);
  if (!parsed) {
    const review: ReviewItem = {
      id: uid('rev'),
      kind: 'parse_failed',
      fingerprint,
      rawPreview: `${raw.title ? `${raw.title} | ` : ''}${raw.body}`.slice(0, 240),
      occurredAt: raw.occurredAt,
      createdAt: Date.now(),
      resolved: false,
    };
    // Still store a placeholder source-less review; attach source meta in review only
    await putReview(review);
    // Keep a shadow source row linked to a parse-failed txn so fingerprint stays unique
    const now = Date.now();
    const txn: Transaction = {
      id: uid('txn'),
      amountCents: 0,
      direction: 'expense',
      occurredAt: raw.occurredAt || now,
      merchant: '解析失败',
      category: '未分类',
      primaryChannel: raw.channel,
      status: 'parse_failed',
      createdAt: now,
      updatedAt: now,
    };
    const source: TransactionSource = {
      id: uid('src'),
      transactionId: txn.id,
      channel: raw.channel,
      fingerprint,
      packageOrAddress: raw.packageOrAddress,
      title: raw.title,
      rawBody: raw.body,
      occurredAt: raw.occurredAt || now,
      capturedAt: now,
      meta: raw.meta,
    };
    review.candidateTxnId = txn.id;
    review.sourceId = source.id;
    await putTransaction(txn);
    await putSource(source);
    await putReview(review);
    emitDataChange();
    return { action: 'parse_failed', fingerprint, transactionId: txn.id, reviewId: review.id };
  }

  const ctx = await loadMatchContext();
  const decision = matchExistingTransaction({
    parsed,
    fingerprint,
    raw,
    ...ctx,
  });

  const now = Date.now();
  const meta: Record<string, string> = { ...(raw.meta ?? {}) };
  if (parsed.cardLast4) meta.cardLast4 = parsed.cardLast4;
  if (parsed.payChannelHint) meta.payChannelHint = parsed.payChannelHint;

  if (decision.kind === 'merge') {
    const txn = decision.txn;
    const sources = ctx.sourcesByTxn.get(txn.id) ?? [];
    const source: TransactionSource = {
      id: uid('src'),
      transactionId: txn.id,
      channel: raw.channel,
      fingerprint,
      packageOrAddress: raw.packageOrAddress,
      title: raw.title,
      rawBody: raw.body,
      occurredAt: parsed.occurredAt,
      capturedAt: now,
      meta,
    };
    const betterMerchant =
      txn.merchant === '未知商户' && parsed.merchant !== '未知商户'
        ? parsed.merchant
        : txn.merchant;
    const updated: Transaction = {
      ...txn,
      merchant: betterMerchant,
      primaryChannel: pickPrimaryChannel(txn, sources, raw.channel, raw.body),
      updatedAt: now,
    };
    await putSource(source);
    await putTransaction(updated);
    emitDataChange();
    return { action: 'merged', fingerprint, transactionId: txn.id };
  }

  const category = await classifyMerchant(parsed.merchant, raw.body);
  const txn: Transaction = {
    id: uid('txn'),
    amountCents: parsed.amountCents,
    direction: parsed.direction,
    occurredAt: parsed.occurredAt,
    merchant: parsed.merchant,
    category,
    primaryChannel: raw.channel,
    status: decision.kind === 'suspect' || parsed.confidence < 0.5 ? 'needs_review' : 'confirmed',
    createdAt: now,
    updatedAt: now,
  };
  const source: TransactionSource = {
    id: uid('src'),
    transactionId: txn.id,
    channel: raw.channel,
    fingerprint,
    packageOrAddress: raw.packageOrAddress,
    title: raw.title,
    rawBody: raw.body,
    occurredAt: parsed.occurredAt,
    capturedAt: now,
    meta,
  };
  await putTransaction(txn);
  await putSource(source);

  if (decision.kind === 'suspect') {
    const review: ReviewItem = {
      id: uid('rev'),
      kind: 'suspected_duplicate',
      candidateTxnId: txn.id,
      existingTxnId: decision.txn.id,
      sourceId: source.id,
      fingerprint,
      amountCents: parsed.amountCents,
      occurredAt: parsed.occurredAt,
      merchant: parsed.merchant,
      rawPreview: raw.body.slice(0, 240),
      createdAt: now,
      resolved: false,
    };
    await putReview(review);
    emitDataChange();
    return { action: 'queued_review', fingerprint, transactionId: txn.id, reviewId: review.id };
  }

  emitDataChange();
  return { action: 'created', fingerprint, transactionId: txn.id };
}

export async function ingestMany(raws: RawCapture[]): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const raw of raws) {
    results.push(await ingestCapture(raw));
  }
  return results;
}
