import { Button } from '@/shared/Button';
import { formatMonthTitle } from '@/shared/format';
import { isCurrentMonth } from './monthParam';
import styles from './MonthScreen.module.scss';

interface Props {
  month: string;
  onPrev: () => void;
  onNext: () => void;
}

export function MonthHeader({ month, onPrev, onNext }: Props) {
  return (
    <div className={styles.header}>
      <Button aria-label="Предыдущий месяц" onClick={onPrev}>‹</Button>
      <h1 className={styles.month}>{formatMonthTitle(month)}</h1>
      <Button aria-label="Следующий месяц" disabled={isCurrentMonth(month)} onClick={onNext}>›</Button>
    </div>
  );
}
