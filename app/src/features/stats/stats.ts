import type { MonthlyStat, MonthRange } from '@/api/types';

// Окно статистики: календарный год целиком.
export const yearRange = (year: number): MonthRange => ({ from: `${String(year)}-01-01`, to: `${String(year)}-12-31` });

export interface MonthTotal {
  month: string;
  total: number;
}

export interface BreakdownRow {
  code: string;
  amount: number;
  share: number;
}

export interface Forecast {
  daysPassed: number;
  daysInMonth: number;
  perDay: number;
  projected: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;

export const toYM = (monthISO: string): string => monthISO.slice(0, 7);

// Выбранный месяц может исчезнуть из данных после рефетча (например, диапазон
// сдвинулся) — тогда откатываемся на текущий месяц, а если и его нет, на последний
// доступный.
export function pickMonth(selected: string | null, months: string[], currentMonth: string): string {
  if (selected !== null && months.includes(selected)) return selected;
  if (months.includes(currentMonth)) return currentMonth;
  return months[months.length - 1] ?? currentMonth;
}

// Русское склонение «день/дня/дней» по числу n.
export function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}

export function monthTotals(rows: MonthlyStat[]): MonthTotal[] {
  const acc = new Map<string, number>();
  for (const row of rows) {
    const ym = toYM(row.month);
    acc.set(ym, (acc.get(ym) ?? 0) + row.amount);
  }
  return [...acc.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([month, total]) => ({ month, total: round2(total) }));
}

export function monthBreakdown(rows: MonthlyStat[], month: string): BreakdownRow[] {
  const inMonth = rows.filter((row) => toYM(row.month) === month);
  const total = inMonth.reduce((s, row) => s + row.amount, 0);
  return inMonth
    .map((row) => ({
      code: row.code,
      amount: round2(row.amount),
      share: total > 0 ? round1((100 * row.amount) / total) : 0,
    }))
    .sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      // «?» — в конец при равенстве, остальные по коду
      if (a.code === '?') return 1;
      if (b.code === '?') return -1;
      return a.code.localeCompare(b.code);
    });
}

export function codeTrend(rows: MonthlyStat[], code: string, months: string[]): MonthTotal[] {
  const byMonth = new Map<string, number>();
  for (const row of rows) {
    if (row.code === code) byMonth.set(toYM(row.month), (byMonth.get(toYM(row.month)) ?? 0) + row.amount);
  }
  return months.map((month) => ({ month, total: round2(byMonth.get(month) ?? 0) }));
}

// Прогноз на конец текущего месяца при том же среднем дневном темпе.
// daysPassed включает сегодня, поэтому первого числа делим на 1, а не на 0.
export function forecast(total: number, todayISO: string): Forecast {
  const [y, m, d] = todayISO.split('-').map(Number);
  const daysPassed = Math.max(1, d ?? 1);
  const daysInMonth = new Date(y ?? 1970, m ?? 1, 0).getDate();
  const perDay = round2(total / daysPassed);
  return { daysPassed, daysInMonth, perDay, projected: round2(perDay * daysInMonth) };
}
