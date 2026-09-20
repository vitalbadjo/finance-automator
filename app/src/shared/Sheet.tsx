import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import styles from './Sheet.module.scss';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

// Нижний лист без сторонних библиотек: рендерим через portal в body, блокируем
// прокрутку страницы, пока лист открыт, закрываем по Escape и клику по фону.
export function Sheet({ open, title, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={styles.overlay}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={styles.panel}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className={styles.header}>
          <p className={styles.title}>{title}</p>
          <Button
            aria-label="Закрыть"
            onClick={onClose}
          >
            Закрыть
          </Button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
