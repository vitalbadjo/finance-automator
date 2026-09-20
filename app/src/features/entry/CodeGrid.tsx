import type { CodeRef } from '@/api/types';
import { Button } from '@/shared/Button';
import styles from './CodeGrid.module.scss';

interface Props {
  codes: CodeRef[];
  value: string | null;
  onChange: (code: string) => void;
}

// Порядок разделов — по первому встреченному sort_order, сами коды уже
// отсортированы функцией app_codes.
const groupBySection = (codes: CodeRef[]): [string, CodeRef[]][] => {
  const map = new Map<string, CodeRef[]>();
  for (const c of codes) {
    const list = map.get(c.section);
    if (list) list.push(c);
    else map.set(c.section, [c]);
  }
  return [...map.entries()];
};

export function CodeGrid({ codes, value, onChange }: Props) {
  return (
    <div role="radiogroup" aria-label="Категория">
      {groupBySection(codes).map(([section, list]) => (
        <div key={section} className={styles.section}>
          <p className={styles.title}>{section}</p>
          <div className={styles.grid}>
            {list.map((c) => (
              <Button
                key={c.code}
                role="radio"
                aria-checked={c.code === value}
                title={c.title}
                className={[styles.chip, c.code === value ? styles.active : ''].join(' ')}
                onClick={() => {
                  onChange(c.code);
                }}
              >
                {c.code}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
