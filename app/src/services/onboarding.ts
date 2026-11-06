import { getMeta, setMeta } from './db';
import { isNotifyAccessEnabled } from '../plugins/notifyListener';
import { getBatteryOptimizationStatus } from '../plugins/backgroundKeep';

const ONBOARDING_DONE_KEY = 'onboardingCompleted';

export interface PermissionSnapshot {
  notifyEnabled: boolean;
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
  const [notifyEnabled, battery] = await Promise.all([
    isNotifyAccessEnabled(),
    getBatteryOptimizationStatus(),
  ]);
  return {
    notifyEnabled,
    batteryIgnored: battery.ignoring,
    manufacturer: battery.manufacturer,
    brand: battery.brand,
  };
}

export function hasCriticalPermissions(snap: PermissionSnapshot): boolean {
  return snap.notifyEnabled;
}
