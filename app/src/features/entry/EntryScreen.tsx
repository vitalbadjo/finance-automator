import { useEffect, useReducer, useRef, useState } from 'react';
import { useAddTxnMutation, useGetCodesQuery } from '@/api/api';
import { supabase } from '@/api/supabase';
import { Button } from '@/shared/Button';
import { Field } from '@/shared/Field';
import { Toast } from '@/shared/Toast';
import { AmountField } from './AmountField';
import { CodeGrid } from './CodeGrid';
import { CurrencyToggle } from './CurrencyToggle';
import { DatePicker } from './DatePicker';
import { TodayList } from './TodayList';
import { entryReducer, initialEntry } from './entryReducer';
import { pushRecentCurrency, readRecentCurrencies } from './recentCurrencies';
import { todayISO } from './dates';
import styles from './EntryScreen.module.scss';

interface ToastState {
  message: string;
  kind: 'ok' | 'err';
}

export function EntryScreen() {
  const [currencies, setCurrencies] = useState(readRecentCurrencies);
  const [state, dispatch] = useReducer(entryReducer, initialEntry(currencies[0] ?? 'USD', todayISO()));
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const codes = useGetCodesQuery();
  const [addTxn, { isLoading: saving }] = useAddTxnMutation();

  const amount = Number(state.amount);
  const canSave = !saving && state.code !== null && Number.isFinite(amount) && amount > 0;

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

  const save = async () => {
    if (!canSave || state.code === null) return;
    const result = await addTxn({
      date: state.date,
      amount,
      currency: state.currency,
      code: state.code,
      note: state.note.trim() === '' ? null : state.note.trim(),
    });
    if ('error' in result && result.error) {
      show(result.error.message ?? 'Неизвестная ошибка', 'err');
      return;
    }
    setCurrencies(pushRecentCurrency(state.currency));
    dispatch({ type: 'saved' });
    show('Записано', 'ok');
  };

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

      <AmountField
        value={state.amount}
        autoFocus
        onChange={(v) => {
          dispatch({ type: 'amount', value: v });
        }}
      />
      <CurrencyToggle
        value={state.currency}
        options={currencies}
        onChange={(v) => {
          dispatch({ type: 'currency', value: v });
        }}
      />

      {codes.isLoading && <p className={styles.muted}>Загружаем категории…</p>}
      {codes.error && <p className={styles.muted}>Категории не загрузились: {codes.error.message}</p>}
      {codes.data && (
        <CodeGrid
          codes={codes.data}
          value={state.code}
          onChange={(v) => {
            dispatch({ type: 'code', value: v });
          }}
        />
      )}

      <DatePicker
        value={state.date}
        onChange={(v) => {
          dispatch({ type: 'date', value: v });
        }}
      />
      <Field
        id="note"
        label="Заметка"
        placeholder="необязательно"
        value={state.note}
        onChange={(e) => {
          dispatch({ type: 'note', value: e.target.value });
        }}
      />

      <Button
        variant="primary"
        disabled={!canSave}
        onClick={() => {
          void save();
        }}
      >
        {saving ? 'Сохраняем…' : 'Сохранить'}
      </Button>

      <TodayList />
      <Toast message={toast?.message ?? null} kind={toast?.kind ?? 'ok'} />
    </main>
  );
}
