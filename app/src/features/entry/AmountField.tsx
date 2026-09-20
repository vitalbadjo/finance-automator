import { Field } from '@/shared/Field';
import styles from './entry.module.scss';

interface Props {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}

// Разделитель — точка или запятая, приводим к точке; больше двух знаков
// после разделителя не пускаем, всё остальное отбрасываем на вводе.
const clean = (raw: string): string => {
  const s = raw.replace(',', '.').replace(/[^\d.]/g, '');
  const [int = '', frac] = s.split('.');
  return frac === undefined ? int : `${int}.${frac.slice(0, 2)}`;
};

export function AmountField({ value, onChange, autoFocus }: Props) {
  return (
    <Field
      id="amount"
      label="Сумма"
      className={styles.amount}
      inputMode="decimal"
      placeholder="0.00"
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => {
        onChange(clean(e.target.value));
      }}
    />
  );
}
