import { Capacitor, registerPlugin } from '@capacitor/core';
import { ingestCapture } from '../services/ingest';
import {
  emitNotificationCaptured,
  shouldCaptureNotification,
  type NativeNotification,
} from './notifyListener';
import type { NativeSmsMessage } from './smsReader';
import { addressMatches, bodyLooksLikeLedgerSms, getSmsFilters } from '../services/smsFilters';

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
  if (!shouldCaptureNotification(n)) return;
  void ingestCapture({
    channel: 'notify',
    packageOrAddress: n.packageName,
    title: n.title,
    body: n.text || n.title,
    occurredAt: n.postTime,
    nativeId: n.key,
    meta: { via: 'notification-listener' },
  });
}

async function ingestIncomingSms(m: NativeSmsMessage): Promise<void> {
  if (!bodyLooksLikeLedgerSms(m.body || '')) return;
  const filters = await getSmsFilters();
  const hit =
    filters.length === 0 ||
    filters.some((f) => f.address && addressMatches(m.address || '', f.address));
  if (!hit) return;
  await ingestCapture({
    channel: 'sms',
    packageOrAddress: m.address,
    body: m.body,
    occurredAt: m.date,
    nativeId: String(m.id),
    meta: { via: 'sms-receiver' },
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

  void SmsEvents.addListener('sms', (m) => {
    void ingestIncomingSms(m);
  });
}
