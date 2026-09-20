import { useEffect, useRef, useState } from 'react';
import { useDispatch, useStore } from 'react-redux';
import { useGetCodesQuery, useGetMonthTxnsQuery } from '@/api/api';
import { supabase } from '@/api/supabase';
import type { AppDispatch, RootState } from '@/app/store';
import { OfflineBar } from '@/offline/OfflineBar';
import { selectPending } from '@/offline/state';
import { enqueueTxn } from '@/offline/thunks';
import { Button } from '@/shared/Button';
import { TabBar } from '@/shared/TabBar';
import { Toast } from '@/shared/Toast';
import { EntryForm } from './EntryForm';
import { TodayList } from './TodayList';
import { initialEntry } from './entryReducer';
import { frequentCodes } from './frequentCodes';
import { pushRecentCurrency, readRecentCurrencies } from './recentCurrencies';
import { pushRecentCode, readRecentCodes } from './recentCodes';
import { monthRange, todayISO } from './dates';
import styles from './EntryScreen.module.scss';

interface ToastState {
  message: string;
  kind: 'ok' | 'err';
}

export function EntryScreen() {
  const [currencies, setCurrencies] = useState(readRecentCurrencies);
  const [recentCodes, setRecentCodes] = useState(readRecentCodes);
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const codes = useGetCodesQuery();
  const month = useGetMonthTxnsQuery(monthRange(todayISO()));
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();
  const [saving, setSaving] = useState(false);

  const baseCurrency = month.data?.[0]?.base_currency ?? 'USD';
  const frequent = frequentCodes(month.data ?? [], recentCodes, codes.data ?? []);

  const show = (message: string, kind: 'ok' | 'err') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, kind });
    timer.current = setTimeout(() => {
      setToast(null);
    }, kind === 'ok' ? 2000 : 5000);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <main className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>Новая трата</h1>
        <Button
          variant="ghost"
          onClick={() => {
            void supabase.auth.signOut();
          }}
        >
          Выйти
        </Button>
      </div>

      <EntryForm
        initial={initialEntry(currencies[0] ?? 'USD', todayISO())}
        codes={codes.data}
        codesError={codes.error ? (codes.error.message ?? 'Неизвестная ошибка') : null}
        frequent={frequent}
        currencies={[...currencies.slice(0, 3), baseCurrency]}
        onAddCurrency={(code) => {
          setCurrencies(pushRecentCurrency(code));
        }}
        submitLabel="Сохранить"
        busy={saving}
        autoFocus
        onSubmit={async (v) => {
          const before = new Set(selectPending(store.getState()).map((i) => i.id));
          setSaving(true);
          try {
            await dispatch(enqueueTxn(v));
          } finally {
            setSaving(false);
          }
          const mine = selectPending(store.getState()).find((i) => !before.has(i.id));
          if (mine?.error) {
            show(mine.error, 'err');
            return false;
          }
          setCurrencies(pushRecentCurrency(v.currency));
          setRecentCodes(pushRecentCode(v.code));
          show('Записано', 'ok');
          return true;
        }}
      />

      <TodayList />
      <Toast message={toast?.message ?? null} kind={toast?.kind ?? 'ok'} />
      <OfflineBar />
      <TabBar />
    </main>
  );
}
