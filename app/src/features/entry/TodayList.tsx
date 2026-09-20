import { useGetMonthTxnsQuery } from '@/api/api';
import { formatMoney, formatTime } from '@/shared/format';
import { monthRange, todayISO } from './dates';
import styles from './TodayList.module.scss';

const SOURCE_LABEL: Record<string, string> = { manual: 'вручную', bybit_card: 'карта' };

export function TodayList() {
  const today = todayISO();
  const { data, isLoading, error } = useGetMonthTxnsQuery(monthRange(today));
  const rows = (data ?? []).filter((t) => t.txn_date === today);

  return (
    <section className={styles.list} aria-label="Сегодня">
      <p className={styles.title}>Сегодня</p>
      {isLoading && <p className={styles.empty}>Загружаем…</p>}
      {error && <p className={styles.empty}>Не удалось загрузить список: {error.message}</p>}
      {!isLoading && !error && rows.length === 0 && <p className={styles.empty}>Пока ничего</p>}
      {rows.map((t) => (
        <div key={`${t.source}:${t.external_id}`} className={styles.item}>
          {/* вручную добавленные строки хранятся с временем полуночи по Белграду —
              оно всегда показывало бы 00:00, поэтому для них время скрываем,
              оставляя пустую ячейку для выравнивания сетки */}
          <span className={styles.time}>{t.source === 'manual' ? '' : formatTime(t.txn_at)}</span>
          <span className={styles.name}>
            {t.note ?? t.merchant_name ?? '—'}
            <span className={styles.code}>
              {t.code ?? '?'} · {SOURCE_LABEL[t.source] ?? t.source}
            </span>
          </span>
          <span className={styles.sum}>{formatMoney(t.amount, t.currency)}</span>
        </div>
      ))}
    </section>
  );
}
