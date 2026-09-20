import type { QueuedTxn } from './types';
import { toDisplayRow } from './toDisplayRow';

const item: QueuedTxn = {
  id: 'uuid-1',
  args: { date: '2026-09-20', amount: 12.5, currency: 'USD', code: 'каф', note: 'кофе' },
  createdAt: '2026-09-20T09:00:00Z',
  attempts: 0,
  error: null,
};

describe('toDisplayRow', () => {
  it('строка выглядит как ручная запись и помечена pending', () => {
    const row = toDisplayRow(item, 'USD');
    expect(row).toMatchObject({
      external_id: 'uuid-1',
      source: 'manual',
      txn_date: '2026-09-20',
      amount: 12.5,
      currency: 'USD',
      base_amount: 12.5,
      code: 'каф',
      kind: 'expense',
      note: 'кофе',
      pending: true,
    });
  });

  it('другая валюта — без суммы в базовой', () => {
    expect(toDisplayRow({ ...item, args: { ...item.args, currency: 'RSD' } }, 'USD').base_amount).toBeNull();
  });
});
