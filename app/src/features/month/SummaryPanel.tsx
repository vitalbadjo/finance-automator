import { Button } from '@/shared/Button';
import { formatMoney } from '@/shared/format';
import type { MonthSummary } from './summary';
import styles from './MonthScreen.module.scss';

export type SourceFilter = 'all' | 'bybit_card' | 'manual';

const isSourceFilter = (s: string): s is SourceFilter => s === 'bybit_card' || s === 'manual';

interface Props {
  summary: MonthSummary;
  baseCurrency: string;
  sources: string[];
  filterCode: string | null;
  onFilterCode: (code: string | null) => void;
  filterSource: SourceFilter;
  onFilterSource: (s: SourceFilter) => void;
}

const SOURCE_LABEL: Record<string, string> = { bybit_card: 'карта', manual: 'вручную' };

export function Summary({ summary, baseCurrency, sources, filterCode, onFilterCode, filterSource, onFilterSource }: Props) {
  return (
    <section aria-label="Итоги">
      <h2 className={styles.total}>{formatMoney(summary.total, baseCurrency)}</h2>
      <div className={styles.chips}>
        {summary.byCode.map((c) => (
          <Button
            key={c.code}
            aria-pressed={filterCode === c.code}
            className={[styles.chip, filterCode === c.code ? styles.chipOn : ''].join(' ')}
            onClick={() => {
              onFilterCode(filterCode === c.code ? null : c.code);
            }}
          >
            {c.code} · {formatMoney(c.amount, baseCurrency)}
          </Button>
        ))}
      </div>
      {summary.cashOut > 0 && <p className={styles.muted}>Снято наличными {formatMoney(summary.cashOut, baseCurrency)}</p>}
      {summary.missingRate > 0 && (
        <p className={styles.muted}>Трат без курса: {summary.missingRate}, они не в итоге</p>
      )}
      {sources.length > 1 && (
        <div className={styles.sources} role="group" aria-label="Источник">
          {sources.map((s) => (
            <Button
              key={s}
              aria-pressed={filterSource === s}
              className={[styles.chip, filterSource === s ? styles.chipOn : ''].join(' ')}
              onClick={() => {
                onFilterSource(filterSource === s ? 'all' : isSourceFilter(s) ? s : 'all');
              }}
            >
              {SOURCE_LABEL[s] ?? s}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
