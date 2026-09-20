import { formatMoney } from '@/shared/format';
import type { BreakdownRow } from './stats';
import styles from './StatsScreen.module.scss';

interface Props {
  rows: BreakdownRow[];
  titles: Map<string, string>;
  baseCurrency: string;
  onSelect: (code: string) => void;
}

export function Breakdown({ rows, titles, baseCurrency, onSelect }: Props) {
  return (
    <ul className={styles.list} aria-label="Категории">
      {rows.map((row) => {
        const title = row.code === '?' ? 'без категории' : (titles.get(row.code) ?? row.code);
        return (
          <li key={row.code}>
            <button
              type="button"
              className={styles.row}
              onClick={() => {
                onSelect(row.code);
              }}
            >
              <span className={styles.code}>{row.code}</span>
              <span className={styles.name}>
                {title}
                <span className={styles.track}>
                  <span className={styles.fill} style={{ width: `${String(row.share)}%` }} />
                </span>
              </span>
              <span className={styles.sum}>
                {formatMoney(row.amount, baseCurrency)}
                <span className={styles.share}>{row.share.toLocaleString('ru-RU')}%</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
