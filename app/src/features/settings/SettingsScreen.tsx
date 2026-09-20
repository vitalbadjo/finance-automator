import { useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router';
import { useGetSettingsQuery } from '@/api/api';
import type { SettingsSource } from '@/api/types';
import { OfflineBar } from '@/offline/OfflineBar';
import { selectPendingCount } from '@/offline/state';
import { Button } from '@/shared/Button';
import { TabBar } from '@/shared/TabBar';
import { Toast } from '@/shared/Toast';
import { applyTheme, readTheme, type Theme } from '@/shared/theme';
import { useToast } from '@/shared/useToast';
import { RenameSourceSheet, SourceRow } from './SourceRow';
import styles from './SettingsScreen.module.scss';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Как в системе' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
];

export function SettingsScreen() {
  const { data, isLoading, error } = useGetSettingsQuery();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [renaming, setRenaming] = useState<SettingsSource | null>(null);
  const { toast, show } = useToast();
  const pendingCount = useSelector(selectPendingCount);

  return (
    <main className={[styles.wrap, pendingCount > 0 ? styles.withBar : ''].join(' ')}>
      <h1 className={styles.title}>Ещё</h1>

      <section className={styles.section}>
        <h2 className={styles.h2}>Тема</h2>
        <div role="radiogroup" aria-label="Тема" className={styles.row}>
          {THEMES.map((t) => (
            <Button
              key={t.value}
              role="radio"
              aria-checked={theme === t.value}
              className={[styles.chip, theme === t.value ? styles.chipOn : ''].join(' ')}
              onClick={() => {
                applyTheme(t.value);
                setTheme(t.value);
              }}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </section>

      {isLoading && <p className={styles.muted}>Загружаем…</p>}
      {error && <p className={styles.muted}>Не удалось загрузить: {error.message}</p>}
      {data && (
        <>
          <section className={styles.section}>
            <h2 className={styles.h2}>Базовая валюта</h2>
            <p className={styles.value}>{data.base_currency}</p>
            <p className={styles.muted}>Меняется вместе с курсами, отдельной задачей</p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.h2}>Источники</h2>
            <div className={styles.list}>
              {data.sources.map((s) => (
                <SourceRow
                  key={s.code}
                  source={s}
                  onClick={() => {
                    setRenaming(s);
                  }}
                />
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.h2}>Справочники</h2>
            <Link to="/settings/codes" className={styles.link}>
              Категории <span className={styles.itemRight}>{data.codes.length}</span>
            </Link>
            <Link to="/settings/rules" className={styles.link}>
              Правила по мерчантам{' '}
              <span className={styles.itemRight}>
                {data.rules.length}
                {data.unmapped.length > 0 && ` · без категории: ${String(data.unmapped.length)}`}
              </span>
            </Link>
          </section>
        </>
      )}

      {renaming && (
        <RenameSourceSheet
          key={renaming.code}
          source={renaming}
          onClose={() => {
            setRenaming(null);
          }}
          onDone={(m) => {
            setRenaming(null);
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
