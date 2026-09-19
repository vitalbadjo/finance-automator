import type { InputHTMLAttributes } from 'react';
import styles from './Field.module.scss';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Field({ label, id, className, ...rest }: Props) {
  return (
    <label className={styles.field} htmlFor={id}>
      <span className={styles.label}>{label}</span>
      <input id={id} className={[styles.input, className ?? ''].join(' ')} {...rest} />
    </label>
  );
}
