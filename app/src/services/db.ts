import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  CategoryRule,
  NegativePair,
  ReviewItem,
  Transaction,
  TransactionSource,
} from './types';

interface BookkeepingDB extends DBSchema {
  transactions: {
    key: string;
    value: Transaction;
    indexes: { 'by-occurredAt': number; 'by-status': string };
  };
  sources: {
    key: string;
    value: TransactionSource;
    indexes: { 'by-fingerprint': string; 'by-transactionId': string };
  };
  /** Legacy store kept so existing IndexedDB upgrades don't break. */
  smsFilters: {
    key: string;
    value: { id: string; label: string; address?: string; remark?: string; createdAt: number };
  };
  categoryRules: {
    key: string;
    value: CategoryRule;
  };
  reviews: {
    key: string;
    value: ReviewItem;
    indexes: { 'by-resolved': number };
  };
  negativePairs: {
    key: string;
    value: NegativePair;
  };
  meta: {
    key: string;
    value: { key: string; value: string };
  };
}

const DB_NAME = 'bookkeeping-local';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<BookkeepingDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<BookkeepingDB>> {
  if (!dbPromise) {
    dbPromise = openDB<BookkeepingDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const tx = db.createObjectStore('transactions', { keyPath: 'id' });
        tx.createIndex('by-occurredAt', 'occurredAt');
        tx.createIndex('by-status', 'status');

        const sources = db.createObjectStore('sources', { keyPath: 'id' });
        sources.createIndex('by-fingerprint', 'fingerprint', { unique: true });
        sources.createIndex('by-transactionId', 'transactionId');

        db.createObjectStore('smsFilters', { keyPath: 'id' });
        db.createObjectStore('categoryRules', { keyPath: 'id' });

        const reviews = db.createObjectStore('reviews', { keyPath: 'id' });
        reviews.createIndex('by-resolved', 'resolved');

        db.createObjectStore('negativePairs', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
  }
  return dbPromise;
}

export async function listTransactions(): Promise<Transaction[]> {
  const db = await getDb();
  const all = await db.getAll('transactions');
  return all.sort((a, b) => b.occurredAt - a.occurredAt);
}

export async function getTransaction(id: string): Promise<Transaction | undefined> {
  const db = await getDb();
  return db.get('transactions', id);
}

export async function putTransaction(txn: Transaction): Promise<void> {
  const db = await getDb();
  await db.put('transactions', txn);
}

export async function listSourcesByTxn(transactionId: string): Promise<TransactionSource[]> {
  const db = await getDb();
  return db.getAllFromIndex('sources', 'by-transactionId', transactionId);
}

export async function getSourceByFingerprint(fp: string): Promise<TransactionSource | undefined> {
  const db = await getDb();
  return db.getFromIndex('sources', 'by-fingerprint', fp);
}

export async function putSource(source: TransactionSource): Promise<void> {
  const db = await getDb();
  await db.put('sources', source);
}

export async function listCategoryRules(): Promise<CategoryRule[]> {
  const db = await getDb();
  return db.getAll('categoryRules');
}

export async function putCategoryRule(rule: CategoryRule): Promise<void> {
  const db = await getDb();
  await db.put('categoryRules', rule);
}

export async function listOpenReviews(): Promise<ReviewItem[]> {
  const db = await getDb();
  const all = await db.getAll('reviews');
  return all.filter((r) => !r.resolved).sort((a, b) => b.createdAt - a.createdAt);
}

export async function putReview(item: ReviewItem): Promise<void> {
  const db = await getDb();
  await db.put('reviews', item);
}

export async function listNegativePairs(): Promise<NegativePair[]> {
  const db = await getDb();
  return db.getAll('negativePairs');
}

export async function putNegativePair(pair: NegativePair): Promise<void> {
  const db = await getDb();
  await db.put('negativePairs', pair);
}

export async function getMeta(key: string): Promise<string | undefined> {
  const db = await getDb();
  const row = await db.get('meta', key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key, value });
}
