import { Capacitor, registerPlugin } from '@capacitor/core';

interface BackgroundKeepPlugin {
  isIgnoringBatteryOptimizations(): Promise<{
    ignoring: boolean;
    manufacturer?: string;
    brand?: string;
  }>;
  requestIgnoreBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  openBatterySettings(): Promise<void>;
  openAutostartSettings(): Promise<{ opened: boolean; fallback?: string }>;
}

const Native = registerPlugin<BackgroundKeepPlugin>('BackgroundKeep');

export async function getBatteryOptimizationStatus(): Promise<{
  ignoring: boolean;
  manufacturer: string;
  brand: string;
}> {
  if (!Capacitor.isNativePlatform()) {
    return { ignoring: true, manufacturer: 'web', brand: 'web' };
  }
  const res = await Native.isIgnoringBatteryOptimizations();
  return {
    ignoring: !!res.ignoring,
    manufacturer: res.manufacturer ?? '',
    brand: res.brand ?? '',
  };
}

export async function requestIgnoreBatteryOptimizations(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  const res = await Native.requestIgnoreBatteryOptimizations();
  return !!res.ignoring;
}

export async function openBatterySettings(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await Native.openBatterySettings();
}

export async function openAutostartSettings(): Promise<{ opened: boolean; fallback?: string }> {
  if (!Capacitor.isNativePlatform()) return { opened: false };
  return Native.openAutostartSettings();
}

export function needsAggressiveOemGuide(manufacturer: string, brand: string): boolean {
  const blob = `${manufacturer} ${brand}`.toLowerCase();
  return /xiaomi|redmi|poco|huawei|honor|oppo|realme|vivo|iqoo|oneplus|meizu|samsung/.test(blob);
}
