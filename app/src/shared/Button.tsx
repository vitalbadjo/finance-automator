import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.scss';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'default';
}

export function Button({ variant = 'default', className, ...rest }: Props) {
  const cls = [styles.btn, variant !== 'default' ? styles[variant] : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return <button type="button" className={cls} {...rest} />;
}
