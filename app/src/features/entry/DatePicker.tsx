import { Button } from '@/shared/Button';
import { Field } from '@/shared/Field';
import { shiftISO, todayISO } from './dates';
import styles from './entry.module.scss';

interface Props {
  value: string;
  onChange: (iso: string) => void;
}

export function DatePicker({ value, onChange }: Props) {
  const today = todayISO();
  const yesterday = shiftISO(today, -1);
  const quick = value === today ? { label: 'Вчера', to: yesterday } : { label: 'Сегодня', to: today };
  return (
    <div className={styles.dateRow}>
      <Field
        id="date"
        label="Дата"
        type="date"
        className={styles.dateInput}
        value={value}
        max={today}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      <Button
        onClick={() => {
          onChange(quick.to);
        }}
      >
        {quick.label}
      </Button>
    </div>
  );
}
