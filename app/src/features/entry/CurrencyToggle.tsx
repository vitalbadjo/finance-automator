import { useState } from 'react';
import { Button } from '@/shared/Button';
import styles from './entry.module.scss';

interface Props {
  value: string;
  options: string[];
  onChange: (code: string) => void;
  onAdd?: (code: string) => void;
}

const CODE_RE = /^[A-Za-z]{3}$/;

export function CurrencyToggle({ value, options, onChange, onAdd }: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const submit = () => {
    if (CODE_RE.test(draft)) {
      onAdd?.(draft.toUpperCase());
    }
    setDraft('');
    setAdding(false);
  };

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
      {onAdd &&
        (adding ? (
          <span className={styles.addRow}>
            <input
              className={styles.addInput}
              value={draft}
              maxLength={3}
              autoCapitalize="characters"
              aria-label="Новая валюта"
              placeholder="RSD"
              onChange={(e) => {
                setDraft(e.target.value);
              }}
            />
            <Button
              className={styles.toggleBtn}
              onClick={() => {
                submit();
              }}
            >
              ОК
            </Button>
          </span>
        ) : (
          <Button
            className={styles.toggleBtn}
            aria-label="Добавить валюту"
            onClick={() => {
              setAdding(true);
            }}
          >
            +
          </Button>
        ))}
    </div>
  );
}
