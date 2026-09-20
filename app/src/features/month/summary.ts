import type { MonthTxn } from '@/api/types';

export interface MonthSummary {
  total: number;
  byCode: { code: string; amount: number }[];
  cashOut: number;
  missingRate: number;
}

export interface DayGroup {
  date: string;
  subtotal: number;
  rows: MonthTxn[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// На экране месяца видны расходы и снятия наличных. Отказы и нулевые
// авторизации — не деньги, они остаются в базе для v_zero_auth.
export const visibleRows = (txns: MonthTxn[]): MonthTxn[] =>
  txns.filter((t) => t.kind === 'expense' || t.kind === 'transfer');

const isCounted = (t: MonthTxn): t is MonthTxn & { base_amount: number } =>
  t.kind === 'expense' && t.base_amount !== null;

export function summarize(txns: MonthTxn[]): MonthSummary {
  const byCode = new Map<string, number>();
  let total = 0;
  let cashOut = 0;
  let missingRate = 0;
  for (const t of txns) {
    if (t.kind === 'expense' && t.base_amount === null) missingRate += 1;
    if (isCounted(t)) {
      total += t.base_amount;
      const key = t.code ?? '?';
      byCode.set(key, (byCode.get(key) ?? 0) + t.base_amount);
    }
    if (t.kind === 'transfer' && t.status === 'success' && t.base_amount !== null) {
      cashOut += t.base_amount;
    }
  }
  return {
    total: round2(total),
    byCode: [...byCode.entries()]
      .map(([code, amount]) => ({ code, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount || a.code.localeCompare(b.code)),
    cashOut: round2(cashOut),
    missingRate,
  };
}

export function groupByDay(txns: MonthTxn[]): DayGroup[] {
  const days = new Map<string, MonthTxn[]>();
  for (const t of txns) {
    const list = days.get(t.txn_date);
    if (list) list.push(t);
    else days.set(t.txn_date, [t]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, rows]) => ({
      date,
      rows: [...rows].sort((a, b) => (a.txn_at < b.txn_at ? 1 : a.txn_at > b.txn_at ? -1 : 0)),
      subtotal: round2(rows.filter(isCounted).reduce((s, t) => s + t.base_amount, 0)),
    }));
}
