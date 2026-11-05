import {
  getTransaction,
  listSourcesByTxn,
  putNegativePair,
  putReview,
  putSource,
  putTransaction,
  listOpenReviews,
} from './db';
import { emitDataChange } from './events';
import { learnCategoryFromUser } from './classify';
import type { ReviewItem, Transaction } from './types';

export async function getOpenReviews(): Promise<ReviewItem[]> {
  return listOpenReviews();
}

export async function confirmDistinct(review: ReviewItem): Promise<void> {
  if (!review.existingTxnId || !review.fingerprint) {
    await resolveReview(review);
    return;
  }
  const sources = await listSourcesByTxn(review.existingTxnId);
  const existingFp = sources[0]?.fingerprint;
  if (existingFp) {
    await putNegativePair({
      id: `neg_${Date.now().toString(36)}`,
      fingerprintA: review.fingerprint,
      fingerprintB: existingFp,
      createdAt: Date.now(),
    });
    // also pair against all sources of existing
    for (const s of sources) {
      await putNegativePair({
        id: `neg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        fingerprintA: review.fingerprint,
        fingerprintB: s.fingerprint,
        createdAt: Date.now(),
      });
    }
  }
  if (review.candidateTxnId) {
    const txn = await getTransaction(review.candidateTxnId);
    if (txn) {
      await putTransaction({ ...txn, status: 'confirmed', updatedAt: Date.now() });
    }
  }
  await resolveReview(review);
}

export async function mergeReviewIntoExisting(review: ReviewItem): Promise<void> {
  if (!review.candidateTxnId || !review.existingTxnId) {
    await resolveReview(review);
    return;
  }
  const candidate = await getTransaction(review.candidateTxnId);
  const existing = await getTransaction(review.existingTxnId);
  if (!candidate || !existing) {
    await resolveReview(review);
    return;
  }
  const candidateSources = await listSourcesByTxn(candidate.id);
  for (const src of candidateSources) {
    await putSource({ ...src, transactionId: existing.id });
  }
  // Soft-delete candidate by marking parse_failed zero amount? Better: mark and hide
  await putTransaction({
    ...candidate,
    amountCents: 0,
    status: 'parse_failed',
    note: `已合并到 ${existing.id}`,
    updatedAt: Date.now(),
  });
  const betterMerchant =
    existing.merchant === '未知商户' && candidate.merchant !== '未知商户'
      ? candidate.merchant
      : existing.merchant;
  await putTransaction({
    ...existing,
    merchant: betterMerchant,
    status: 'confirmed',
    updatedAt: Date.now(),
  });
  await resolveReview(review);
}

export async function updateTxnCategory(txn: Transaction, category: string): Promise<void> {
  await putTransaction({ ...txn, category, status: 'confirmed', updatedAt: Date.now() });
  if (txn.merchant && txn.merchant !== '未知商户' && txn.merchant !== '解析失败') {
    await learnCategoryFromUser(txn.merchant, category);
  }
  emitDataChange();
}

async function resolveReview(review: ReviewItem): Promise<void> {
  await putReview({ ...review, resolved: true });
  emitDataChange();
}
