import type { MonthRange } from '@/api/types';
import { monthRange } from '@/features/entry/dates';
import { shiftMonth } from '@/features/month/monthParam';

// Окно статистики: 12 месяцев, заканчивая текущим.
export const statsRange = (todayISO: string): MonthRange => {
  const ym = todayISO.slice(0, 7);
  const from = monthRange(`${shiftMonth(ym, -11)}-01`).from;
  const to = monthRange(`${ym}-01`).to;
  return { from, to };
};
