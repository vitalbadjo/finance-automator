import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '@/app/store';
import { Button } from '@/shared/Button';
import { Sheet } from '@/shared/Sheet';
import { formatDayTitle, formatMoney } from '@/shared/format';
import { removeTxn, retryTxn } from './thunks';
import { selectPending } from './state';
import styles from './OfflineBar.module.scss';

interface Props {
  open: boolean;
  onClose: () => void;
}

// Список неотправленных записей: отказавшие показывают текст ошибки и дают
// повторить отправку или удалить запись из очереди.
export function PendingSheet({ open, onClose }: Props) {
  const dispatch = useDispatch<AppDispatch>();
  const pending = useSelector(selectPending);

  return (
    <Sheet open={open} title="Не отправлено" onClose={onClose}>
      {pending.map((item) => (
        <div key={item.id} className={styles.row}>
          <span className={styles.meta}>
            {formatDayTitle(item.args.date)} · {formatMoney(item.args.amount, item.args.currency)} · {item.args.code}
            {item.args.note !== null && ` · ${item.args.note}`}
          </span>
          {item.error !== null && <span className={styles.error}>{item.error}</span>}
          <div className={styles.actions}>
            <Button
              onClick={() => {
                void dispatch(retryTxn(item.id));
              }}
            >
              Отправить снова
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                void dispatch(removeTxn(item.id));
              }}
            >
              Удалить
            </Button>
          </div>
        </div>
      ))}
    </Sheet>
  );
}
