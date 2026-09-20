import type { MonthTxn } from '@/api/types';
import { groupByDay, summarize, visibleRows } from './summary';

let n = 0;
const row = (over: Partial<MonthTxn>): MonthTxn => ({
  external_id: `id-${String(++n)}`,
  source: 'bybit_card',
  txn_date: '2026-09-19',
  txn_at: '2026-09-19T10:00:00+00:00',
  merchant_name: 'Lidl',
  amount: 10,
  currency: 'USD',
  base_amount: 10,
  base_currency: 'USD',
  code: 'прод',
  kind: 'expense',
  status: 'success',
  note: null,
  code_override: null,
  ...over,
});

describe('visibleRows', () => {
  it('оставляет расходы и снятия, прячет отказы и авторизации', () => {
    const rows = [row({ kind: 'expense' }), row({ kind: 'transfer' }), row({ kind: 'void' }), row({ kind: 'auth' })];
    expect(visibleRows(rows).map((r) => r.kind)).toEqual(['expense', 'transfer']);
  });
});

describe('summarize', () => {
  it('итог только по расходам с курсом, категории по убыванию', () => {
    const s = summarize([
      row({ code: 'прод', base_amount: 10 }),
      row({ code: 'каф', base_amount: 25 }),
      row({ code: 'прод', base_amount: 5 }),
      row({ kind: 'transfer', base_amount: 100 }),
      row({ code: 'каф', base_amount: null, currency: 'RSD' }),
    ]);
    expect(s.total).toBe(40);
    expect(s.byCode).toEqual([
      { code: 'каф', amount: 25 },
      { code: 'прод', amount: 15 },
    ]);
    expect(s.cashOut).toBe(100);
    expect(s.missingRate).toBe(1);
  });

  it('снятие считается только проведённое', () => {
    const s = summarize([row({ kind: 'transfer', status: 'in_progress', base_amount: 50 })]);
    expect(s.cashOut).toBe(0);
  });

  it('расход без кода попадает в итог как "?"', () => {
    const s = summarize([row({ code: null, base_amount: 7 })]);
    expect(s.total).toBe(7);
    expect(s.byCode).toEqual([{ code: '?', amount: 7 }]);
  });
});

describe('groupByDay', () => {
  it('дни по убыванию, строки внутри дня по времени, подытог без снятий', () => {
    const g = groupByDay([
      row({ txn_date: '2026-09-18', txn_at: '2026-09-18T09:00:00+00:00', base_amount: 1 }),
      row({ txn_date: '2026-09-19', txn_at: '2026-09-19T08:00:00+00:00', base_amount: 2 }),
      row({ txn_date: '2026-09-19', txn_at: '2026-09-19T12:00:00+00:00', base_amount: 3 }),
      row({ txn_date: '2026-09-19', kind: 'transfer', base_amount: 100 }),
    ]);
    expect(g.map((d) => d.date)).toEqual(['2026-09-19', '2026-09-18']);
    expect(g[0]?.subtotal).toBe(5);
    expect(g[0]?.rows.map((r) => r.txn_at)).toEqual([
      '2026-09-19T12:00:00+00:00',
      '2026-09-19T10:00:00+00:00',
      '2026-09-19T08:00:00+00:00',
    ]);
    expect(g[1]?.subtotal).toBe(1);
  });
});
