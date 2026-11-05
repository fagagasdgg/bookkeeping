import { getMeta, setMeta } from './db';
import { checkSmsPermission } from '../plugins/smsReader';
import { isNotifyAccessEnabled } from '../plugins/notifyListener';
import { getBatteryOptimizationStatus } from '../plugins/backgroundKeep';

const ONBOARDING_DONE_KEY = 'onboardingCompleted';

export interface PermissionSnapshot {
  notifyEnabled: boolean;
  smsGranted: boolean;
  batteryIgnored: boolean;
  manufacturer: string;
  brand: string;
}

export async function isOnboardingCompleted(): Promise<boolean> {
  return (await getMeta(ONBOARDING_DONE_KEY)) === '1';
}

export async function markOnboardingCompleted(): Promise<void> {
  await setMeta(ONBOARDING_DONE_KEY, '1');
}

export async function resetOnboarding(): Promise<void> {
  await setMeta(ONBOARDING_DONE_KEY, '0');
}

export async function getPermissionSnapshot(): Promise<PermissionSnapshot> {
  const [notifyEnabled, smsGranted, battery] = await Promise.all([
    isNotifyAccessEnabled(),
    checkSmsPermission(),
    getBatteryOptimizationStatus(),
  ]);
  return {
    notifyEnabled,
    smsGranted,
    batteryIgnored: battery.ignoring,
    manufacturer: battery.manufacturer,
    brand: battery.brand,
  };
}

export function hasCriticalPermissions(snap: PermissionSnapshot): boolean {
  return snap.notifyEnabled && snap.smsGranted;
}
