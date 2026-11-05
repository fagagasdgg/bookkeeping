import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeSmsMessage {
  id: number;
  address: string;
  body: string;
  date: number;
  person?: string;
}

export interface SmsQueryOptions {
  address?: string;
  bodyContains?: string;
  limit?: number;
}

interface SmsReaderPlugin {
  checkPermission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  queryInbox(options: SmsQueryOptions): Promise<{ messages: NativeSmsMessage[] }>;
  startWatching(): Promise<{ watching: boolean }>;
  stopWatching(): Promise<void>;
}

const SmsReaderNative = registerPlugin<SmsReaderPlugin>('SmsReader');

const webStore: NativeSmsMessage[] = [];

export async function checkSmsPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  const res = await SmsReaderNative.checkPermission();
  return res.granted;
}

export async function requestSmsPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  const res = await SmsReaderNative.requestPermission();
  return res.granted;
}

export async function queryInboxSms(options: SmsQueryOptions = {}): Promise<NativeSmsMessage[]> {
  if (!Capacitor.isNativePlatform()) {
    return webStore
      .filter((m) => {
        if (options.address && !m.address.includes(options.address)) return false;
        if (options.bodyContains && !`${m.body}${m.person || ''}`.includes(options.bodyContains)) {
          return false;
        }
        return true;
      })
      .slice(0, options.limit ?? 500);
  }
  const res = await SmsReaderNative.queryInbox(options);
  return res.messages ?? [];
}

export async function startSmsWatching(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const res = await SmsReaderNative.startWatching();
  return res.watching;
}

/** Browser-only helper for local UI testing */
export function __debugPushWebSms(msg: NativeSmsMessage): void {
  webStore.unshift(msg);
}
