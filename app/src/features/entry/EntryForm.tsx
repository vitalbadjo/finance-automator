import { useReducer, useRef, type ReactNode } from 'react';
import type { CodeRef } from '@/api/types';
import { Button } from '@/shared/Button';
import { Field } from '@/shared/Field';
import { AmountField } from './AmountField';
import { CodePicker } from './CodePicker';
import { CurrencyToggle } from './CurrencyToggle';
import { DatePicker } from './DatePicker';
import { entryReducer, type EntryState } from './entryReducer';
import styles from './EntryScreen.module.scss';

export interface EntryValues {
  date: string;
  amount: number;
  currency: string;
  code: string;
  note: string | null;
}

interface Props {
  initial: EntryState;
  codes: CodeRef[] | undefined;
  codesError: string | null;
  frequent: string[];
  currencies: string[];
  onAddCurrency: (code: string) => void;
  submitLabel: string;
  busy: boolean;
  onSubmit: (values: EntryValues) => Promise<boolean>;
  autoFocus?: boolean;
  children?: ReactNode;
}

// Форма ввода, общая для экрана «Ввод» и шторки правки. Состояние живёт
// здесь; родитель получает готовые значения в onSubmit и отвечает true,
// если запись сохранилась — тогда сумма и заметка очищаются.
export function EntryForm({
  initial,
  codes,
  codesError,
  frequent,
  currencies,
  onAddCurrency,
  submitLabel,
  busy,
  onSubmit,
  autoFocus,
  children,
}: Props) {
  const [state, dispatch] = useReducer(entryReducer, initial);
  const inFlight = useRef(false);

  const amount = Number(state.amount);
  const canSave = !busy && state.code !== null && Number.isFinite(amount) && amount > 0;
  const options = [...currencies, state.currency].filter((c, i, arr) => arr.indexOf(c) === i);

  const submit = async () => {
    if (!canSave || state.code === null || inFlight.current) return;
    inFlight.current = true;
    try {
      const ok = await onSubmit({
        date: state.date,
        amount,
        currency: state.currency,
        code: state.code,
        note: state.note.trim() === '' ? null : state.note.trim(),
      });
      if (ok) dispatch({ type: 'saved' });
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <>
      <AmountField
        value={state.amount}
        {...(autoFocus ? { autoFocus: true } : {})}
        onChange={(v) => {
          dispatch({ type: 'amount', value: v });
        }}
      />
      <CurrencyToggle
        value={state.currency}
        options={options}
        onChange={(v) => {
          dispatch({ type: 'currency', value: v });
        }}
        onAdd={(code) => {
          onAddCurrency(code);
          dispatch({ type: 'currency', value: code });
        }}
      />

      {codes === undefined && codesError === null && <p className={styles.muted}>Загружаем категории…</p>}
      {codesError !== null && <p className={styles.muted}>Категории не загрузились: {codesError}</p>}
      {codes && (
        <CodePicker
          codes={codes}
          value={state.code}
          onChange={(v) => {
            dispatch({ type: 'code', value: v });
          }}
          frequent={frequent}
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
          void submit();
        }}
      >
        {busy ? 'Сохраняем…' : submitLabel}
      </Button>
      {children}
    </>
  );
}
