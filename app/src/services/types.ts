export type Direction = 'expense' | 'income';
export type Channel = 'sms' | 'notify';
export type TxnStatus = 'confirmed' | 'needs_review' | 'parse_failed';
export type ReviewKind = 'parse_failed' | 'suspected_duplicate';

export interface Transaction {
  id: string;
  amountCents: number;
  direction: Direction;
  occurredAt: number;
  merchant: string;
  category: string;
  primaryChannel: Channel;
  status: TxnStatus;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TransactionSource {
  id: string;
  transactionId: string;
  channel: Channel;
  fingerprint: string;
  packageOrAddress: string;
  title?: string;
  rawBody: string;
  occurredAt: number;
  capturedAt: number;
  meta?: Record<string, string>;
}

export interface SmsSourceFilter {
  id: string;
  label: string;
  address?: string;
  remark?: string;
  createdAt: number;
}

export interface CategoryRule {
  id: string;
  keyword: string;
  category: string;
  createdAt: number;
}

export interface ReviewItem {
  id: string;
  kind: ReviewKind;
  candidateTxnId?: string;
  existingTxnId?: string;
  sourceId?: string;
  fingerprint: string;
  amountCents?: number;
  occurredAt?: number;
  merchant?: string;
  rawPreview: string;
  createdAt: number;
  resolved: boolean;
}

export interface NegativePair {
  id: string;
  fingerprintA: string;
  fingerprintB: string;
  createdAt: number;
}

export interface ParsedCandidate {
  amountCents: number;
  direction: Direction;
  occurredAt: number;
  merchant: string;
  cardLast4?: string;
  payChannelHint?: 'alipay' | 'wechat' | 'unionpay' | 'other';
  confidence: number;
}

export interface RawCapture {
  channel: Channel;
  packageOrAddress: string;
  title?: string;
  body: string;
  occurredAt: number;
  nativeId?: string;
  meta?: Record<string, string>;
}

export interface IngestResult {
  action: 'created' | 'merged' | 'duplicate' | 'queued_review' | 'parse_failed';
  transactionId?: string;
  reviewId?: string;
  fingerprint: string;
}

export type PeriodKind = 'day' | 'week' | 'month';

export interface PeriodSummary {
  expenseCents: number;
  incomeCents: number;
  balanceCents: number;
  byCategory: Array<{ category: string; expenseCents: number; incomeCents: number }>;
  byChannel: Array<{ channel: Channel; expenseCents: number; incomeCents: number }>;
}
