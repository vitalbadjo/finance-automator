import type { KeyboardEvent } from 'react';
import styles from './BarChart.module.scss';

export interface BarItem {
  key: string;
  label: string;
  value: number;
}

interface Props {
  items: BarItem[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  formatValue: (value: number) => string;
}

// Размеры в единицах viewBox; svg тянется на ширину контейнера.
const W = 320;
const H = 140;
const TOP = 18; // место под значение активного столбца
const BOTTOM = 18; // место под подписи
const GAP = 6;

export function BarChart({ items, activeKey, onSelect, formatValue }: Props) {
  if (items.length === 0) return null;
  const max = Math.max(...items.map((i) => i.value), 0);
  const slot = W / items.length;
  const barW = Math.max(4, slot - GAP);
  const plotH = H - TOP - BOTTOM;

  const onKey = (e: KeyboardEvent<SVGGElement>, key: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(key);
    }
  };

  return (
    // role="img" на <svg> скрывает вложенные кнопки от Testing Library / a11y-дерева,
    // поэтому роль/подпись оставлены только на самих столбцах.
    <svg className={styles.svg} viewBox={`0 0 ${String(W)} ${String(H)}`}>
      {items.map((item, i) => {
        const h = max > 0 ? (item.value / max) * plotH : 0;
        const x = i * slot + GAP / 2;
        const y = TOP + plotH - h;
        const active = item.key === activeKey;
        return (
          <g
            key={item.key}
            className={styles.group}
            role="button"
            tabIndex={0}
            aria-pressed={active}
            aria-label={`${item.label}: ${formatValue(item.value)}`}
            onClick={() => {
              onSelect(item.key);
            }}
            onKeyDown={(e) => {
              onKey(e, item.key);
            }}
          >
            <rect
              className={[styles.bar, active ? styles.barActive : ''].join(' ')}
              x={x}
              y={y}
              width={barW}
              height={h}
              rx={3}
            />
            <text className={styles.label} x={x + barW / 2} y={H - 4}>
              {item.label}
            </text>
            {active ? (
              <text className={styles.value} x={x + barW / 2} y={Math.max(12, y - 5)}>
                {formatValue(item.value)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
