import { Button } from '@/shared/Button';
import styles from './entry.module.scss';

interface Props {
  value: string;
  options: string[];
  onChange: (code: string) => void;
}

export function CurrencyToggle({ value, options, onChange }: Props) {
  return (
    <div className={styles.toggle} role="radiogroup" aria-label="Валюта">
      {options.map((c) => (
        <Button
          key={c}
          role="radio"
          aria-checked={c === value}
          className={[styles.toggleBtn, c === value ? styles.active : ''].join(' ')}
          onClick={() => {
            onChange(c);
          }}
        >
          {c}
        </Button>
      ))}
    </div>
  );
}
