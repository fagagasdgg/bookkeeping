import { Capacitor, registerPlugin } from '@capacitor/core';
import { ingestCapture } from '../services/ingest';
import { emitNotificationCaptured, isPaymentPackage, type NativeNotification } from './notifyListener';
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

/**
 * Wire Capacitor plugin events into the shared ingest pipeline.
 */
export function bindNativeCaptureEvents(): void {
  if (!Capacitor.isNativePlatform() || bound) return;
  bound = true;

  void NotifyEvents.addListener('notification', (n) => {
    emitNotificationCaptured(n);
    if (!isPaymentPackage(n.packageName)) return;
    void ingestCapture({
      channel: 'notify',
      packageOrAddress: n.packageName,
      title: n.title,
      body: n.text,
      occurredAt: n.postTime,
      nativeId: n.key,
    });
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
