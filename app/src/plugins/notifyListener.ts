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

/** Packages we care about for payment capture — WeChat + Alipay only. */
export const PAYMENT_PACKAGES = new Set([
  'com.eg.android.AlipayGphone',
  'com.alipay.mobile.android',
  'com.tencent.mm',
]);

export function isPaymentPackage(pkg: string): boolean {
  if (PAYMENT_PACKAGES.has(pkg)) return true;
  return /alipay|tencent\.mm/i.test(pkg);
}
