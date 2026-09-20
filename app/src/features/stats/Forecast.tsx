import { formatMoney } from '@/shared/format';
import { forecast } from './stats';
import styles from './StatsScreen.module.scss';

interface Props {
  total: number;
  todayISO: string;
  baseCurrency: string;
}

export function Forecast({ total, todayISO, baseCurrency }: Props) {
  const f = forecast(total, todayISO);
  return (
    <p className={styles.muted}>
      {f.daysPassed} дней из {f.daysInMonth} · в среднем {formatMoney(f.perDay, baseCurrency)} в день · к концу месяца
      около {formatMoney(f.projected, baseCurrency)}
    </p>
  );
}
