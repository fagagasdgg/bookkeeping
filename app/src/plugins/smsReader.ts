import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeSmsMessage {
  id: number;
  address: string;
  body: string;
  date: number;
  person?: string;
  threadId?: number;
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

export interface SmsInboxDiagnosis {
  manufacturer: string;
  brand: string;
  permissionGranted: boolean;
  oemLikelyXiaomiFamily: boolean;
  oemLikelyVivoFamily?: boolean;
  totalInbox: number;
  bankLikeCount: number;
  likelyMissingNotificationSms: boolean;
  hint: string;
  rawAddresses?: string[];
}

export interface SmsConversationResult {
  messages: NativeSmsMessage[];
  threadIds: number[];
  discoveredAddresses: string[];
  seedAddresses: string[];
  seedHits: number;
  conversationCount: number;
}

interface SmsReaderPlugin {
  checkPermission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  queryInbox(options: SmsQueryOptions): Promise<{ messages: NativeSmsMessage[] }>;
  queryRecent(options?: { limit?: number }): Promise<{ messages: NativeSmsMessage[] }>;
  queryConversation(options: { needle: string; limit?: number }): Promise<SmsConversationResult>;
  probeSenders(options?: { limit?: number; needle?: string }): Promise<{ samples: SmsSenderSample[] }>;
  diagnoseInbox(): Promise<SmsInboxDiagnosis>;
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

/** 不按发件人过滤，直接取最新 N 条，供正文关键字扫描。 */
export async function queryRecentSms(limit = 300): Promise<NativeSmsMessage[]> {
  if (!Capacitor.isNativePlatform()) {
    return webStore.slice(0, limit);
  }
  const res = await SmsReaderNative.queryRecent({ limit });
  return res.messages ?? [];
}

/**
 * 按会话拉取：用 needle（如 95588）定位会话 thread，再取出该会话里全部短信。
 * 对应手机短信 App「列表一条 → 点开很多条」的模型。
 */
export async function queryConversationSms(
  needle: string,
  limit = 5000,
): Promise<SmsConversationResult> {
  const n = needle.trim();
  if (!Capacitor.isNativePlatform()) {
    const messages = webStore
      .filter((m) => `${m.address}\n${m.body}`.includes(n))
      .slice(0, limit);
    const addresses = [...new Set(messages.map((m) => m.address).filter(Boolean))];
    return {
      messages,
      threadIds: [],
      discoveredAddresses: addresses,
      seedAddresses: addresses,
      seedHits: messages.length,
      conversationCount: messages.length,
    };
  }
  return SmsReaderNative.queryConversation({ needle: n, limit });
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

export async function diagnoseSmsInbox(): Promise<SmsInboxDiagnosis> {
  if (!Capacitor.isNativePlatform()) {
    return {
      manufacturer: 'web',
      brand: 'web',
      permissionGranted: true,
      oemLikelyXiaomiFamily: false,
      totalInbox: webStore.length,
      bankLikeCount: webStore.filter((m) => /95588|工商银行|财付通|支出|支付宝/.test(`${m.address}${m.body}`))
        .length,
      likelyMissingNotificationSms: false,
      hint: '浏览器预览模式，使用内存样例短信。',
      rawAddresses: webStore.slice(0, 15).map((m) => m.address || '(空地址)'),
    };
  }
  return SmsReaderNative.diagnoseInbox();
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

/** Browser-only helper for local UI testing */
export function __debugPushWebSms(msg: NativeSmsMessage): void {
  webStore.unshift(msg);
}
