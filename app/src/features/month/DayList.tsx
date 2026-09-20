import type { MonthTxn } from '@/api/types';
import { formatDayTitle, formatMoney } from '@/shared/format';
import type { DayGroup } from './summary';
import { TxnRow } from './TxnRow';
import styles from './MonthScreen.module.scss';

interface Props {
  days: DayGroup[];
  baseCurrency: string;
  onRowClick: (txn: MonthTxn) => void;
}

export function DayList({ days, baseCurrency, onRowClick }: Props) {
  if (days.length === 0) return <p className={styles.empty}>За этот месяц записей нет</p>;
  return (
    <section aria-label="Транзакции">
      {days.map((d) => (
        <div key={d.date} className={styles.day}>
          <p className={styles.dayTitle}>
            {d.subtotal === 0 ? formatDayTitle(d.date) : `${formatDayTitle(d.date)} · ${formatMoney(d.subtotal, baseCurrency)}`}
          </p>
          {d.rows.map((t) => (
            <TxnRow key={`${t.source}:${t.external_id}`} txn={t} onClick={onRowClick} />
          ))}
        </div>
      ))}
    </section>
  );
}
