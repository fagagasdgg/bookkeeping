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

/** 支付 / 银行 App：整包捕获（再靠解析筛无效通知） */
export const PAYMENT_PACKAGES = new Set([
  'com.eg.android.AlipayGphone',
  'com.alipay.mobile.android',
  'com.tencent.mm',
  'com.icbc',
  'com.chinamworld.main',
  'com.icbc.androidclient',
  'com.android.bankabc',
  'com.chinamworld.bocmbci',
  'com.yitong.mbank.psbc',
  'com.cmbchina.ccd.pluto.cmbActivity',
  'cmb.pb',
  'com.unionpay',
]);

/** 短信 / 智能短信 App：仅当正文像动账时才记账 */
export const SMS_APP_PACKAGES = new Set([
  'com.android.mms',
  'com.google.android.apps.messaging',
  'com.android.messaging',
  'com.samsung.android.messaging',
  'com.huawei.message',
  'com.miui.smsextra',
  'com.xiaomi.mms',
  'com.coloros.mms',
  'com.oplus.mms',
  'com.vivo.mms',
  'com.bbk.sms',
  'com.android.mms.service',
]);

export function isPaymentPackage(pkg: string): boolean {
  if (PAYMENT_PACKAGES.has(pkg)) return true;
  return /alipay|tencent\.mm|bank|icbc|ccb|abc|boc|cmb|unionpay|psbc/i.test(pkg);
}

export function isSmsAppPackage(pkg: string): boolean {
  if (SMS_APP_PACKAGES.has(pkg)) return true;
  return /(^|\.)(mms|messaging|sms)(\.|$)/i.test(pkg);
}

/** 通知正文是否像银行/支付动账（用于短信 App、以及银行 App 的噪声过滤） */
export function looksLikeLedgerNotification(title: string, text: string): boolean {
  const blob = `${title}\n${text}`;
  if (!/(元|￥|¥|\d+\.\d{2})/.test(blob)) return false;
  if (!/(支出|收入|消费|支付|入账|扣款|余额|转账|动账|尾号)/.test(blob)) return false;
  return /(955\d{2}|工商银行|建设银行|农业银行|中国银行|招商银行|交通银行|邮储|银行|支付宝|微信|财付通|【.+银行】|尾号)/.test(
    blob,
  );
}

/**
 * 是否应记账：微信/支付宝/银行 App，或短信 App 里的动账通知。
 * （不再读短信数据库；靠通知栏拿你截图里那种「工商银行 / 动账通知」）
 */
export function shouldCaptureNotification(n: NativeNotification): boolean {
  if (isPaymentPackage(n.packageName)) {
    // 银行 App 偶发营销推送：无动账特征则跳过；微信/支付宝仍全量交给解析
    if (/bank|icbc|ccb|abc|boc|cmb|unionpay|psbc/i.test(n.packageName)) {
      return looksLikeLedgerNotification(n.title, n.text);
    }
    return true;
  }
  if (isSmsAppPackage(n.packageName) && looksLikeLedgerNotification(n.title, n.text)) {
    return true;
  }
  // 个别 OEM 把智能短信挂到奇怪包名：标题就是「动账通知」
  if (/动账通知|账户变动|交易提醒/.test(n.title) && looksLikeLedgerNotification(n.title, n.text)) {
    return true;
  }
  return false;
}
