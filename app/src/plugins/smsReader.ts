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

export interface SmsSenderSample {
  address: string;
  person?: string;
  date: number;
  preview: string;
}

interface SmsReaderPlugin {
  checkPermission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  queryInbox(options: SmsQueryOptions): Promise<{ messages: NativeSmsMessage[] }>;
  probeSenders(options?: { limit?: number; needle?: string }): Promise<{ samples: SmsSenderSample[] }>;
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
        if (options.address) {
          const hitAddr = m.address.includes(options.address);
          const hitBody = m.body.includes(options.address);
          if (!hitAddr && !hitBody) return false;
        }
        if (options.bodyContains && !`${m.body}${m.person || ''}`.includes(options.bodyContains)) {
          return false;
        }
        return true;
      })
      .slice(0, options.limit ?? 2000);
  }
  const res = await SmsReaderNative.queryInbox(options);
  return res.messages ?? [];
}

export async function probeSmsSenders(options?: {
  limit?: number;
  needle?: string;
}): Promise<SmsSenderSample[]> {
  if (!Capacitor.isNativePlatform()) {
    return webStore.slice(0, options?.limit ?? 80).map((m) => ({
      address: m.address,
      person: m.person,
      date: m.date,
      preview: m.body.slice(0, 60),
    }));
  }
  const res = await SmsReaderNative.probeSenders(options ?? {});
  return res.samples ?? [];
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
