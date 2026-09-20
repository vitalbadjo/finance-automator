import { useEffect, useRef, useState } from 'react';
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

// Стек открытых листов: вложенный Escape должен закрывать только верхний.
const stack: symbol[] = [];

// Нижний лист без сторонних библиотек: рендерим через portal в body, блокируем
// прокрутку страницы, пока лист открыт, закрываем по Escape и клику по фону.
export function Sheet({ open, title, onClose, children }: Props) {
  // Стабильный id инстанса: создаётся один раз (ленивая инициализация
  // useState) и не зависит от смены onClose при ре-рендерах.
  const [id] = useState(() => Symbol('sheet'));

  // Актуальный onClose храним в ref, чтобы эффект стека не перезапускался
  // при смене немемоизированного колбэка у вызывающей стороны.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    stack.push(id);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === id) onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      const idx = stack.indexOf(id);
      if (idx !== -1) stack.splice(idx, 1);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, id]);

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
