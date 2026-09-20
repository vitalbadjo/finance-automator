import { useState } from 'react';
import { useDeleteRuleMutation, useUpsertRuleMutation } from '@/api/api';
import type { MerchantRule, SettingsCode } from '@/api/types';
import { Button } from '@/shared/Button';
import { Field } from '@/shared/Field';
import { Sheet } from '@/shared/Sheet';
import { groupCodes } from './settings';
import styles from './SettingsScreen.module.scss';

interface Props {
  // Существующее правило, либо заготовка нового (id null): шаблон из
  // блока «Без категории» или пустой.
  rule: MerchantRule | { id: null; pattern: string };
  codes: SettingsCode[];
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}

export function RuleSheet({ rule, codes, onClose, onDone, onError }: Props) {
  const existing = rule.id !== null ? rule : null;
  const [pattern, setPattern] = useState(rule.pattern);
  const [code, setCode] = useState(existing?.code ?? '');
  const [priority, setPriority] = useState(String(existing?.priority ?? 100));
  const [note, setNote] = useState(existing?.note ?? '');
  const [confirm, setConfirm] = useState(false);
  const [upsert, { isLoading: saving }] = useUpsertRuleMutation();
  const [remove, { isLoading: removing }] = useDeleteRuleMutation();
  const busy = saving || removing;

  return (
    <Sheet
      open
      title={existing?.pattern ?? 'Новое правило'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (code === '') {
            onError('Выберите категорию');
            return;
          }
          const prio = Number.parseInt(priority, 10);
          if (Number.isNaN(prio)) {
            onError('Введите число');
            return;
          }
          void (async () => {
            const r = await upsert({
              id: rule.id,
              pattern,
              code,
              priority: prio,
              note: note.trim() === '' ? null : note.trim(),
            });
            if ('error' in r && r.error) {
              onError(r.error.message ?? 'Неизвестная ошибка');
              return;
            }
            onDone('Сохранено');
          })();
        }}
      >
        <Field
          id="rule-pattern"
          label="Шаблон"
          value={pattern}
          maxLength={40}
          autoComplete="off"
          onChange={(e) => {
            setPattern(e.target.value);
          }}
        />
        <label className={styles.form}>
          <span className={styles.muted}>Категория</span>
          <select
            className={styles.select}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
            }}
          >
            <option value="">— не выбрана —</option>
            {groupCodes(codes).map((g) => (
              <optgroup key={g.section} label={g.section}>
                {g.codes.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <Field
          id="rule-priority"
          label="Приоритет"
          type="number"
          inputMode="numeric"
          value={priority}
          onChange={(e) => {
            setPriority(e.target.value);
          }}
        />
        <Field
          id="rule-note"
          label="Заметка"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
        <p className={styles.muted}>Меньше приоритет — важнее. При равном побеждает более длинный шаблон.</p>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={busy}>
            Сохранить
          </Button>
          {existing && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (!confirm) {
                  setConfirm(true);
                  return;
                }
                void (async () => {
                  const r = await remove(existing.id);
                  if ('error' in r && r.error) {
                    setConfirm(false);
                    onError(r.error.message ?? 'Неизвестная ошибка');
                    return;
                  }
                  onDone('Удалено');
                })();
              }}
            >
              {confirm ? 'Точно удалить' : 'Удалить'}
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
