import { useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router';
import { useGetSettingsQuery } from '@/api/api';
import type { MerchantRule } from '@/api/types';
import { OfflineBar } from '@/offline/OfflineBar';
import { selectPendingCount } from '@/offline/state';
import { Button } from '@/shared/Button';
import { TabBar } from '@/shared/TabBar';
import { Toast } from '@/shared/Toast';
import { formatMoney } from '@/shared/format';
import { useToast } from '@/shared/useToast';
import { RuleSheet } from './RuleSheet';
import { patternFromMerchant, sortRules } from './settings';
import styles from './SettingsScreen.module.scss';

type Editing = { kind: 'closed' } | { kind: 'new'; pattern: string } | { kind: 'edit'; rule: MerchantRule };

export function RulesScreen() {
  const { data, isLoading, error } = useGetSettingsQuery();
  const [editing, setEditing] = useState<Editing>({ kind: 'closed' });
  const { toast, show } = useToast();
  const pendingCount = useSelector(selectPendingCount);
  const titles = new Map((data?.codes ?? []).map((c) => [c.code, c.title] as const));

  const close = () => {
    setEditing({ kind: 'closed' });
  };

  return (
    <main className={[styles.wrap, pendingCount > 0 ? styles.withBar : ''].join(' ')}>
      <div className={styles.header}>
        <Link to="/settings" className={styles.back}>
          ← Ещё
        </Link>
        <h1 className={styles.title}>Правила по мерчантам</h1>
      </div>
      {isLoading && <p className={styles.muted}>Загружаем…</p>}
      {error && <p className={styles.muted}>Не удалось загрузить: {error.message}</p>}
      {data && (
        <>
          {data.unmapped.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.h2}>Без категории</h2>
              <div className={styles.list}>
                {data.unmapped.map((u) => (
                  <button
                    key={`${u.merchant}|${u.mcc ?? ''}`}
                    type="button"
                    className={styles.item}
                    onClick={() => {
                      setEditing({ kind: 'new', pattern: patternFromMerchant(u.merchant) });
                    }}
                  >
                    <span className={styles.itemMain}>
                      {u.merchant}
                      <span className={styles.itemSub}>{u.mcc ?? '—'}{u.mcc_desc ? ` · ${u.mcc_desc}` : ''}</span>
                    </span>
                    <span className={styles.itemRight}>
                      {u.txn_count} · {formatMoney(u.amount, data.base_currency)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className={styles.section}>
            <h2 className={styles.h2}>Правила</h2>
            {data.rules.length === 0 && <p className={styles.muted}>Правил пока нет</p>}
            <div className={styles.list}>
              {sortRules(data.rules).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={styles.item}
                  onClick={() => {
                    setEditing({ kind: 'edit', rule: r });
                  }}
                >
                  <span className={styles.itemMain}>
                    {r.pattern}
                    <span className={styles.itemSub}>
                      {r.code} · {titles.get(r.code) ?? '?'}
                      {r.note !== null && ` · ${r.note}`}
                    </span>
                  </span>
                  <span className={styles.itemRight}>{r.priority}</span>
                </button>
              ))}
            </div>
          </section>
          <Button
            onClick={() => {
              setEditing({ kind: 'new', pattern: '' });
            }}
          >
            Добавить
          </Button>
        </>
      )}
      {editing.kind !== 'closed' && data && (
        <RuleSheet
          key={editing.kind === 'edit' ? editing.rule.id : `new:${editing.pattern}`}
          rule={editing.kind === 'edit' ? editing.rule : { id: null, pattern: editing.pattern }}
          codes={data.codes}
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
