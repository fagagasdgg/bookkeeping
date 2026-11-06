import type { PeriodKind } from '../services/types';

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function periodRange(kind: PeriodKind, anchor = Date.now()): { start: number; end: number } {
  const dayStart = startOfDay(anchor);
  if (kind === 'day') {
    return { start: dayStart, end: endOfDay(anchor) };
  }
  if (kind === 'week') {
    const d = new Date(dayStart);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - (day - 1));
    const start = d.getTime();
    const end = endOfDay(start + 6 * 24 * 60 * 60 * 1000);
    return { start, end };
  }
  if (kind === 'year') {
    const d = new Date(dayStart);
    d.setMonth(0, 1);
    const start = d.getTime();
    d.setFullYear(d.getFullYear() + 1, 0, 0);
    return { start, end: endOfDay(d.getTime()) };
  }
  const d = new Date(dayStart);
  d.setDate(1);
  const start = d.getTime();
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return { start, end: endOfDay(d.getTime()) };
}

export function shiftPeriod(kind: PeriodKind, anchor: number, delta: number): number {
  const d = new Date(anchor);
  if (kind === 'day') d.setDate(d.getDate() + delta);
  else if (kind === 'week') d.setDate(d.getDate() + delta * 7);
  else if (kind === 'year') d.setFullYear(d.getFullYear() + delta);
  else d.setMonth(d.getMonth() + delta);
  return d.getTime();
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

export function formatPeriodLabel(kind: PeriodKind, anchor: number): string {
  const d = new Date(anchor);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (kind === 'day') return `${y}-${m}-${day}`;
  if (kind === 'month') return `${y}-${m}`;
  if (kind === 'year') return `${y}年`;
  const { start, end } = periodRange('week', anchor);
  const a = new Date(start);
  const b = new Date(end);
  return `${a.getMonth() + 1}/${a.getDate()} – ${b.getMonth() + 1}/${b.getDate()}`;
}
