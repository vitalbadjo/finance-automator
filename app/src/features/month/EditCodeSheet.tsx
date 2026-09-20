import { useSetCodeMutation } from '@/api/api';
import type { CodeRef, MonthTxn } from '@/api/types';
import { Button } from '@/shared/Button';
import { Sheet } from '@/shared/Sheet';
import { CodePicker } from '@/features/entry/CodePicker';
import { frequentCodes } from '@/features/entry/frequentCodes';
import { readRecentCodes } from '@/features/entry/recentCodes';

interface Props {
  txn: MonthTxn;
  codes: CodeRef[] | undefined;
  monthTxns: MonthTxn[];
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}

// У карточной транзакции править можно только категорию: остальное
// перезапишет следующая выгрузка, а code_override она не трогает.
export function EditCodeSheet({ txn, codes, monthTxns, onClose, onDone, onError }: Props) {
  const [setCode, { isLoading }] = useSetCodeMutation();
  const frequent = frequentCodes(monthTxns, readRecentCodes(), codes ?? []);

  const apply = async (code: string | null) => {
    const r = await setCode({ source: txn.source, id: txn.external_id, code });
    if ('error' in r && r.error) {
      onError(r.error.message ?? 'Неизвестная ошибка');
      return;
    }
    onDone(code === null ? 'Категория по правилу' : 'Категория изменена');
  };

  return (
    <Sheet open title="Категория" onClose={onClose}>
      <p>{txn.merchant_name ?? '—'}</p>
      {codes && (
        <CodePicker
          codes={codes}
          value={txn.code}
          frequent={frequent}
          onChange={(code) => {
            void apply(code);
          }}
        />
      )}
      {txn.code_override !== null && (
        <Button
          variant="ghost"
          disabled={isLoading}
          onClick={() => {
            void apply(null);
          }}
        >
          Сбросить на правило
        </Button>
      )}
    </Sheet>
  );
}
