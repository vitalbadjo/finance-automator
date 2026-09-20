import { useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router';
import { useGetSettingsQuery } from '@/api/api';
import type { SettingsCode } from '@/api/types';
import { OfflineBar } from '@/offline/OfflineBar';
import { selectPendingCount } from '@/offline/state';
import { Button } from '@/shared/Button';
import { TabBar } from '@/shared/TabBar';
import { Toast } from '@/shared/Toast';
import { useToast } from '@/shared/useToast';
import { CodeSheet } from './CodeSheet';
import { groupCodes } from './settings';
import styles from './SettingsScreen.module.scss';

type Editing = { kind: 'closed' } | { kind: 'new' } | { kind: 'edit'; code: SettingsCode };

export function CodesScreen() {
  const { data, isLoading, error } = useGetSettingsQuery();
  const [editing, setEditing] = useState<Editing>({ kind: 'closed' });
  const { toast, show } = useToast();
  const pendingCount = useSelector(selectPendingCount);

  const close = () => {
    setEditing({ kind: 'closed' });
  };

  return (
    <main className={[styles.wrap, pendingCount > 0 ? styles.withBar : ''].join(' ')}>
      <div className={styles.header}>
        <Link to="/settings" className={styles.back}>
          ← Ещё
        </Link>
        <h1 className={styles.title}>Категории</h1>
      </div>
      {isLoading && <p className={styles.muted}>Загружаем…</p>}
      {error && <p className={styles.muted}>Не удалось загрузить: {error.message}</p>}
      {data && (
        <>
          {groupCodes(data.codes).map((g) => (
            <section key={g.section} className={styles.section}>
              <h2 className={styles.h2}>{g.section}</h2>
              <div className={styles.list}>
                {g.codes.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    className={[styles.item, c.hidden ? styles.hidden : ''].join(' ')}
                    onClick={() => {
                      setEditing({ kind: 'edit', code: c });
                    }}
                  >
                    <span className={styles.itemMain}>
                      {c.code} · {c.title}
                      {c.hidden && <span className={styles.itemSub}>скрыта</span>}
                    </span>
                    <span className={styles.itemRight}>{c.sort_order}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          <Button
            onClick={() => {
              setEditing({ kind: 'new' });
            }}
          >
            Добавить
          </Button>
        </>
      )}
      {editing.kind !== 'closed' && (
        <CodeSheet
          key={editing.kind === 'edit' ? editing.code.code : 'new'}
          code={editing.kind === 'edit' ? editing.code : null}
          onClose={close}
          onDone={(m) => {
            close();
            show(m, 'ok');
          }}
          onError={(m) => {
            show(m, 'err');
          }}
        />
      )}
      <Toast message={toast?.message ?? null} kind={toast?.kind ?? 'ok'} />
      <OfflineBar />
      <TabBar />
    </main>
  );
}
