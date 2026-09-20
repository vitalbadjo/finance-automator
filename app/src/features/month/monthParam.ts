import type { MonthRange } from '@/api/types';
import { monthRange, todayISO } from '@/features/entry/dates';

const RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const currentMonth = (): string => todayISO().slice(0, 7);

export const parseMonth = (param: string | null): string =>
  param !== null && RE.test(param) ? param : currentMonth();

export const shiftMonth = (ym: string, delta: number): string => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y ?? 1970, (m ?? 1) - 1 + delta, 1);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const isCurrentMonth = (ym: string): boolean => ym === currentMonth();

export const monthRangeOf = (ym: string): MonthRange => monthRange(`${ym}-01`);
