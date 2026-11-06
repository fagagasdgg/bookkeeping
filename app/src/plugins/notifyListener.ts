import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeNotification {
  key: string;
  packageName: string;
  title: string;
  text: string;
  postTime: number;
}

interface NotifyListenerPlugin {
  isEnabled(): Promise<{ enabled: boolean }>;
  openSettings(): Promise<void>;
  getActive(): Promise<{ notifications: NativeNotification[] }>;
  start(): Promise<{ started: boolean }>;
  stop(): Promise<void>;
}

const NotifyNative = registerPlugin<NotifyListenerPlugin>('NotifyListener');

type NotifyHandler = (n: NativeNotification) => void;
const handlers = new Set<NotifyHandler>();

export function onNotificationCaptured(handler: NotifyHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function emitNotificationCaptured(n: NativeNotification): void {
  for (const h of [...handlers]) h(n);
}

export async function isNotifyAccessEnabled(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const res = await NotifyNative.isEnabled();
  return res.enabled;
}

export async function openNotifyAccessSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await NotifyNative.openSettings();
}

export async function getActiveNotifications(): Promise<NativeNotification[]> {
  if (!Capacitor.isNativePlatform()) return [];
  const res = await NotifyNative.getActive();
  return res.notifications ?? [];
}

export async function startNotifyListener(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const res = await NotifyNative.start();
  return res.started;
}

/** Packages we care about for payment capture */
export const PAYMENT_PACKAGES = new Set([
  'com.eg.android.AlipayGphone',
  'com.alipay.mobile.android',
  'com.tencent.mm',
  'com.chinamworld.main',
  'com.icbc',
  'com.android.bankabc',
  'com.chinamworld.bocmbci',
  'com.yitong.mbank.psbc',
]);

/** System / OEM messaging apps — bank SMS may surface here as notifications. */
export const SMS_APP_PACKAGES = new Set([
  'com.android.mms',
  'com.google.android.apps.messaging',
  'com.android.messaging',
  'com.samsung.android.messaging',
  'com.huawei.message',
  'com.android.contacts', // some OEMs nest SMS UI here
  'com.miui.smsextra',
  'com.xiaomi.mms',
  'com.coloros.mms',
  'com.oplus.mms',
  'com.vivo.mms',
  'com.vivo.assistant',
  'com.vivo.abe',
  'com.bbk.sms',
  'com.iqoo.secure',
  'com.android.mms.service',
]);

export function isPaymentPackage(pkg: string): boolean {
  if (PAYMENT_PACKAGES.has(pkg)) return true;
  return /alipay|tencent\.mm|bank|icbc|ccb|abc|boc|cmb|unionpay/i.test(pkg);
}

export function isSmsAppPackage(pkg: string): boolean {
  if (SMS_APP_PACKAGES.has(pkg)) return true;
  return /(^|\.)(mms|messaging|sms)(\.|$)/i.test(pkg);
}

/** Heuristic: notification body looks like a bank/payment SMS we can parse. */
export function looksLikeBankSmsNotification(title: string, text: string): boolean {
  const blob = `${title}\n${text}`;
  if (!/(元|￥|¥)/.test(blob)) return false;
  if (!/(支出|收入|消费|支付|入账|扣款|余额|财付通|支付宝|微信)/.test(blob)) return false;
  return /(955\d{2}|工商银行|建设银行|农业银行|中国银行|招商银行|交通银行|邮储|银行|【.+银行】)/.test(
    blob,
  );
}
