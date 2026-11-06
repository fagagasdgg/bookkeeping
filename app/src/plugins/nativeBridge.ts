import { Capacitor, registerPlugin } from '@capacitor/core';
import { ingestCapture } from '../services/ingest';
import {
  emitNotificationCaptured,
  isPaymentPackage,
  isSmsAppPackage,
  looksLikeBankSmsNotification,
  type NativeNotification,
} from './notifyListener';
import type { NativeSmsMessage } from './smsReader';

const NotifyEvents = registerPlugin<{
  addListener(
    eventName: 'notification',
    listenerFunc: (n: NativeNotification) => void,
  ): Promise<{ remove: () => void }>;
}>('NotifyListener');

const SmsEvents = registerPlugin<{
  addListener(
    eventName: 'sms',
    listenerFunc: (m: NativeSmsMessage) => void,
  ): Promise<{ remove: () => void }>;
}>('SmsReader');

let bound = false;

function ingestNotification(n: NativeNotification): void {
  if (isPaymentPackage(n.packageName)) {
    void ingestCapture({
      channel: 'notify',
      packageOrAddress: n.packageName,
      title: n.title,
      body: n.text,
      occurredAt: n.postTime,
      nativeId: n.key,
    });
    return;
  }
  // Fallback: OEM blocks reading bank SMS from DB, but messaging app may still post a notification.
  if (isSmsAppPackage(n.packageName) && looksLikeBankSmsNotification(n.title, n.text)) {
    void ingestCapture({
      channel: 'sms',
      packageOrAddress: n.title || n.packageName,
      title: n.title,
      body: n.text,
      occurredAt: n.postTime,
      nativeId: n.key,
      meta: { via: 'sms-app-notification' },
    });
  }
}

/**
 * Wire Capacitor plugin events into the shared ingest pipeline.
 */
export function bindNativeCaptureEvents(): void {
  if (!Capacitor.isNativePlatform() || bound) return;
  bound = true;

  void NotifyEvents.addListener('notification', (n) => {
    emitNotificationCaptured(n);
    ingestNotification(n);
  });

  void SmsEvents.addListener('sms', (m) => {
    void ingestCapture({
      channel: 'sms',
      packageOrAddress: m.address,
      body: m.body,
      occurredAt: m.date,
      nativeId: String(m.id),
    });
  });
}
