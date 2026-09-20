import type { DisplayTxn } from '@/api/types';
import type { QueuedTxn } from './types';

// Неотправленная запись показывается в списках как обычная ручная трата.
// base_amount ставим только когда валюта совпадает с базовой: курса для
// другой валюты у приложения нет, и такая строка не должна искажать итог.
export function toDisplayRow(item: QueuedTxn, baseCurrency: string): DisplayTxn {
  const sameCurrency = item.args.currency === baseCurrency;
  return {
    external_id: item.id,
    source: 'manual',
    txn_date: item.args.date,
    txn_at: `${item.args.date}T00:00:00+00:00`,
    merchant_name: item.args.note,
    amount: item.args.amount,
    currency: item.args.currency,
    base_amount: sameCurrency ? item.args.amount : null,
    base_currency: baseCurrency,
    code: item.args.code,
    kind: 'expense',
    status: 'success',
    note: item.args.note,
    code_override: item.args.code,
    pending: true,
  };
}
