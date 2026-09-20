import type { DisplayTxn } from '@/api/types';
import { formatMoney } from '@/shared/format';
import styles from './MonthScreen.module.scss';

interface Props {
  txn: DisplayTxn;
  onClick: (txn: DisplayTxn) => void;
}

const SOURCE_LABEL: Record<string, string> = { bybit_card: 'карта', manual: 'вручную' };

export function TxnRow({ txn, onClick }: Props) {
  const tag = [
    txn.kind === 'transfer' ? 'наличные' : (SOURCE_LABEL[txn.source] ?? txn.source),
    ...(txn.status === 'in_progress' ? ['в обработке'] : []),
    ...(txn.pending ? ['не отправлено'] : []),
  ].join(' · ');
  const showBase = txn.base_amount !== null && txn.currency !== txn.base_currency;
  return (
    <button
      type="button"
      className={styles.row}
      onClick={() => {
        onClick(txn);
      }}
    >
      <span className={styles.code}>{txn.kind === 'transfer' ? '↓' : (txn.code ?? '?')}</span>
      <span className={styles.name}>
        {txn.note ?? txn.merchant_name ?? '—'}
        <span className={styles.tag}>{tag}</span>
      </span>
      <span className={styles.sum}>
        {formatMoney(txn.amount, txn.currency)}
        {showBase && txn.base_amount !== null && (
          <span className={styles.base}>{formatMoney(txn.base_amount, txn.base_currency)}</span>
        )}
      </span>
    </button>
  );
}
