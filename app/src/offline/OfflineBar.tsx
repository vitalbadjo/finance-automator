import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '@/app/store';
import { PendingSheet } from './PendingSheet';
import { selectHasErrors, selectPendingCount } from './state';
import { flushQueue } from './thunks';
import styles from './OfflineBar.module.scss';

// Плашка над таббаром: счётчик неотправленных записей. Пока ошибок нет —
// тап пытается отправить очередь сразу; как только что-то отказало —
// тап открывает список с причиной и действиями (повторить/удалить).
export function OfflineBar() {
  const dispatch = useDispatch<AppDispatch>();
  const count = useSelector(selectPendingCount);
  const hasErrors = useSelector(selectHasErrors);
  const [open, setOpen] = useState(false);

  if (count === 0) return null;

  return (
    <>
      <button
        type="button"
        className={[styles.bar, hasErrors ? styles.err : ''].join(' ')}
        onClick={() => {
          if (hasErrors) {
            setOpen(true);
            return;
          }
          void dispatch(flushQueue());
        }}
      >
        <span aria-live="polite">Не отправлено: {count}</span>
      </button>
      <PendingSheet
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}
