import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeSmsMessage {
  id: number;
  address: string;
  body: string;
  date: number;
  person?: string;
  threadId?: number;
}

interface SmsReaderPlugin {
  checkPermission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  queryBySender(options: { address: string; limit?: number }): Promise<{
    messages: NativeSmsMessage[];
    discoveredAddresses: string[];
    count: number;
  }>;
  openAppPermissionSettings(): Promise<{ opened: boolean }>;
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

/** 按发件号码（可含 95588 等短号）拉取会话内短信 */
export async function querySmsBySender(
  address: string,
  limit = 5000,
): Promise<{
  messages: NativeSmsMessage[];
  discoveredAddresses: string[];
  count: number;
}> {
  const needle = address.trim();
  if (!needle) return { messages: [], discoveredAddresses: [], count: 0 };
  if (!Capacitor.isNativePlatform()) {
    const messages = webStore
      .filter((m) => `${m.address}\n${m.body}`.includes(needle))
      .slice(0, limit);
    const discoveredAddresses = [...new Set(messages.map((m) => m.address).filter(Boolean))];
    return { messages, discoveredAddresses, count: messages.length };
  }
  return SmsReaderNative.queryBySender({ address: needle, limit });
}

export async function openAppSmsPermissionSettings(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const res = await SmsReaderNative.openAppPermissionSettings();
  return !!res.opened;
}

export async function startSmsWatching(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const res = await SmsReaderNative.startWatching();
  return res.watching;
}

/** Browser-only helper */
export function __debugPushWebSms(msg: NativeSmsMessage): void {
  webStore.unshift(msg);
}
