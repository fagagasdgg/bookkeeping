export function yuanToCents(yuan: number): number {
  return Math.round(yuan * 100);
}

export function formatYuan(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return `${sign}${yuan}.${fen.toString().padStart(2, '0')}`;
}

export function parseYuanString(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').replace(/￥|¥|元/g, '').trim();
  const m = cleaned.match(/-?\d+(?:\.\d{1,2})?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return null;
  return yuanToCents(n);
}
