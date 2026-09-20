import { useState } from 'react';
import type { CodeRef } from '@/api/types';
import { Button } from '@/shared/Button';
import { Sheet } from '@/shared/Sheet';
import { CodeGrid } from './CodeGrid';
import styles from './CodePicker.module.scss';

interface Props {
  codes: CodeRef[];
  value: string | null;
  onChange: (code: string) => void;
  frequent: string[];
}

// Компактный выбор категории: ряд частых чипов + кнопка «Ещё…», открывающая
// полный список (CodeGrid) в нижнем листе.
export function CodePicker({ codes, value, onChange, frequent }: Props) {
  const [open, setOpen] = useState(false);
  const byCode = new Map(codes.map((c) => [c.code, c] as const));

  const chipCodes = [...frequent];
  if (value !== null && !chipCodes.includes(value)) chipCodes.push(value);

  return (
    <div role="radiogroup" aria-label="Категория" className={styles.row}>
      {chipCodes.map((code) => {
        const ref = byCode.get(code);
        return (
          <Button
            key={code}
            role="radio"
            aria-checked={code === value}
            {...(ref !== undefined ? { title: ref.title } : {})}
            className={[styles.chip, code === value ? styles.active : ''].join(' ')}
            onClick={() => {
              onChange(code);
            }}
          >
            {code}
          </Button>
        );
      })}
      <Button
        aria-label="Все категории"
        className={styles.more}
        onClick={() => {
          setOpen(true);
        }}
      >
        Ещё…
      </Button>
      <Sheet
        open={open}
        title="Категория"
        onClose={() => {
          setOpen(false);
        }}
      >
        <CodeGrid
          codes={codes}
          value={value}
          onChange={(code) => {
            onChange(code);
            setOpen(false);
          }}
        />
      </Sheet>
    </div>
  );
}
