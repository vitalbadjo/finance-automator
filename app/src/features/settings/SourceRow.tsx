import { useState } from 'react';
import { useRenameSourceMutation } from '@/api/api';
import type { SettingsSource } from '@/api/types';
import { Button } from '@/shared/Button';
import { Field } from '@/shared/Field';
import { Sheet } from '@/shared/Sheet';
import { formatDateTime } from '@/shared/format';
import styles from './SettingsScreen.module.scss';

const syncLabel = (s: SettingsSource): string => {
  if (s.last_sync_at === null) return '—';
  if (s.last_sync_ok === false) return 'ошибка синхронизации';
  return `синхронизация ${formatDateTime(s.last_sync_at)}`;
};

export function SourceRow({ source, onClick }: { source: SettingsSource; onClick: () => void }) {
  return (
    <button type="button" className={styles.item} onClick={onClick}>
      <span className={styles.itemMain}>
        {source.title}
        <span className={styles.itemSub}>{syncLabel(source)}</span>
      </span>
      <span className={styles.itemRight}>записей: {source.txn_count}</span>
    </button>
  );
}

interface SheetProps {
  source: SettingsSource;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}

export function RenameSourceSheet({ source, onClose, onDone, onError }: SheetProps) {
  const [title, setTitle] = useState(source.title);
  const [rename, { isLoading }] = useRenameSourceMutation();

  return (
    <Sheet open title="Источник" onClose={onClose}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            const r = await rename({ code: source.code, title });
            if ('error' in r && r.error) {
              onError(r.error.message ?? 'Неизвестная ошибка');
              return;
            }
            onDone('Сохранено');
          })();
        }}
      >
        <Field
          id="source-title"
          label="Название"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        <Button type="submit" variant="primary" disabled={isLoading}>
          Сохранить
        </Button>
      </form>
    </Sheet>
  );
}
