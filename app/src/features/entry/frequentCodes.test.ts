import { describe, expect, it } from 'vitest';
import type { CodeRef, MonthTxn } from '@/api/types';
import { frequentCodes } from './frequentCodes';

const codes: CodeRef[] = [
  { code: 'прод', title: 'Продукты', section: 'Базовые', sort_order: 20 },
  { code: 'каф', title: 'Кафе, рестораны', section: 'Комфорт', sort_order: 210 },
  { code: 'тран', title: 'Транспорт', section: 'Базовые', sort_order: 30 },
  { code: 'здор', title: 'Здоровье', section: 'Базовые', sort_order: 40 },
  { code: 'разв', title: 'Развлечения', section: 'Комфорт', sort_order: 220 },
  { code: 'подар', title: 'Подарки', section: 'Комфорт', sort_order: 230 },
];

let seq = 0;
const txn = (code: string | null, kind: MonthTxn['kind'] = 'expense'): MonthTxn => ({
  external_id: `${code ?? 'null'}-${String((seq += 1))}`,
  source: 'manual',
  txn_date: '2026-09-20',
  txn_at: '2026-09-20T00:00:00Z',
  merchant_name: null,
  amount: 100,
  currency: 'USD',
  base_amount: 100,
  base_currency: 'USD',
  code,
  kind,
  status: 'posted',
  note: null,
});

describe('frequentCodes', () => {
  it('считает по количеству, при равенстве — по sort_order', () => {
    const txns = [
      txn('каф'),
      txn('каф'),
      txn('тран'),
      txn('тран'),
      txn('прод'),
      txn('прод'),
      txn('здор'),
      txn('здор'),
    ];
    // каф и тран и прод и здор — по 2 каждый, tie-break по sort_order: прод(20) < тран(30) < здор(40) < каф(210)
    expect(frequentCodes(txns, [], codes, 3)).toEqual(['прод', 'тран', 'здор']);
  });

  it('дополняет из недавних без дублей', () => {
    const txns = [txn('каф'), txn('каф'), txn('тран')];
    // frequent by count: каф(2), тран(1) -> ['каф','тран'], limit 4, fill from recents
    expect(frequentCodes(txns, ['тран', 'здор', 'разв'], codes, 4)).toEqual(['каф', 'тран', 'здор', 'разв']);
  });

  it('игнорирует не-expense строки и неизвестные коды', () => {
    const txns = [txn('каф', 'transfer'), txn('каф'), txn('unknown'), txn('unknown'), txn('unknown')];
    expect(frequentCodes(txns, [], codes, 5)).toEqual(['каф']);
  });

  it('пустые txns и recents дают пустой список', () => {
    expect(frequentCodes([], [], codes, 5)).toEqual([]);
  });
});
