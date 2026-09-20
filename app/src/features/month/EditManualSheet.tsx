import { useState } from 'react';
import { useDeleteTxnMutation, useUpdateTxnMutation } from '@/api/api';
import type { CodeRef, MonthTxn } from '@/api/types';
import { Button } from '@/shared/Button';
import { Sheet } from '@/shared/Sheet';
import { EntryForm } from '@/features/entry/EntryForm';
import { frequentCodes } from '@/features/entry/frequentCodes';
import { readRecentCodes } from '@/features/entry/recentCodes';
import { pushRecentCurrency, readRecentCurrencies } from '@/features/entry/recentCurrencies';
import type { EntryState } from '@/features/entry/entryReducer';

interface Props {
  txn: MonthTxn;
  codes: CodeRef[] | undefined;
  monthTxns: MonthTxn[];
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}

// Шторка правки ручной записи: форма ввода (как на экране «Ввод») плюс
// кнопка удаления с подтверждением вторым тапом.
export function EditManualSheet({ txn, codes, monthTxns, onClose, onDone, onError }: Props) {
  const [update, { isLoading: updating }] = useUpdateTxnMutation();
  const [remove, { isLoading: removing }] = useDeleteTxnMutation();
  const [confirm, setConfirm] = useState(false);
  const [currencies, setCurrencies] = useState(readRecentCurrencies);

  const initial: EntryState = {
    amount: String(txn.amount),
    currency: txn.currency,
    code: txn.code_override ?? txn.code,
    date: txn.txn_date,
    note: txn.note ?? '',
  };
  const frequent = frequentCodes(monthTxns, readRecentCodes(), codes ?? []);

  return (
    <Sheet open title="Запись" onClose={onClose}>
      <EntryForm
        initial={initial}
        codes={codes}
        codesError={null}
        frequent={frequent}
        currencies={[...currencies.slice(0, 3), txn.base_currency]}
        onAddCurrency={(code) => {
          setCurrencies(pushRecentCurrency(code));
        }}
        submitLabel="Сохранить"
        busy={updating || removing}
        onSubmit={async (v) => {
          const r = await update({ id: txn.external_id, ...v });
          if ('error' in r && r.error) {
            onError(r.error.message ?? 'Неизвестная ошибка');
            return false;
          }
          onDone('Сохранено');
          return true;
        }}
      >
        <Button
          variant="ghost"
          disabled={updating || removing}
          onClick={() => {
            if (!confirm) {
              setConfirm(true);
              return;
            }
            void (async () => {
              const r = await remove(txn.external_id);
              if ('error' in r && r.error) {
                onError(r.error.message ?? 'Неизвестная ошибка');
                return;
              }
              onDone('Удалено');
            })();
          }}
        >
          {confirm ? 'Точно удалить' : 'Удалить'}
        </Button>
      </EntryForm>
    </Sheet>
  );
}
