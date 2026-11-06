import { Capacitor, registerPlugin } from '@capacitor/core';
import { ingestCapture } from '../services/ingest';
import {
  emitNotificationCaptured,
  isPaymentPackage,
  type NativeNotification,
} from './notifyListener';

const NotifyEvents = registerPlugin<{
  addListener(
    eventName: 'notification',
    listenerFunc: (n: NativeNotification) => void,
  ): Promise<{ remove: () => void }>;
}>('NotifyListener');

let bound = false;

function ingestNotification(n: NativeNotification): void {
  if (!isPaymentPackage(n.packageName)) return;
  void ingestCapture({
    channel: 'notify',
    packageOrAddress: n.packageName,
    title: n.title,
    body: n.text,
    occurredAt: n.postTime,
    nativeId: n.key,
  });
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
}
