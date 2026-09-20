import { useState } from 'react';
import { useDeleteCodeMutation, useUpsertCodeMutation } from '@/api/api';
import type { CodeSection, SettingsCode } from '@/api/types';
import { Button } from '@/shared/Button';
import { Field } from '@/shared/Field';
import { Sheet } from '@/shared/Sheet';
import { SECTIONS } from './settings';
import styles from './SettingsScreen.module.scss';

interface Props {
  // null — создание новой категории
  code: SettingsCode | null;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}

const isSection = (v: string): v is CodeSection => (SECTIONS as readonly string[]).includes(v);

// Шторка категории. Код правится только при создании: это идентификатор,
// на который ссылаются правила, переопределения и таблица пользователя.
export function CodeSheet({ code, onClose, onDone, onError }: Props) {
  const [id, setId] = useState(code?.code ?? '');
  const [title, setTitle] = useState(code?.title ?? '');
  const [section, setSection] = useState<CodeSection>(code?.section ?? 'Базовые');
  const [order, setOrder] = useState(String(code?.sort_order ?? 100));
  const [hidden, setHidden] = useState(code?.hidden ?? false);
  const [confirm, setConfirm] = useState(false);
  const [upsert, { isLoading: saving }] = useUpsertCodeMutation();
  const [remove, { isLoading: removing }] = useDeleteCodeMutation();
  const busy = saving || removing;

  return (
    <Sheet open title={code?.code ?? 'Новая категория'} onClose={onClose}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            const sortOrder = Number.parseInt(order, 10);
            const r = await upsert({
              code: id.trim(),
              title,
              section,
              sort_order: Number.isFinite(sortOrder) ? sortOrder : 100,
              hidden,
            });
            if ('error' in r && r.error) {
              onError(r.error.message ?? 'Неизвестная ошибка');
              return;
            }
            onDone('Сохранено');
          })();
        }}
      >
        {code === null && (
          <Field
            id="code-id"
            label="Код"
            value={id}
            maxLength={16}
            autoComplete="off"
            onChange={(e) => {
              setId(e.target.value);
            }}
          />
        )}
        <Field
          id="code-title"
          label="Название"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        <label className={styles.form}>
          <span className={styles.muted}>Раздел</span>
          <select
            className={styles.select}
            value={section}
            onChange={(e) => {
              if (isSection(e.target.value)) setSection(e.target.value);
            }}
          >
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <Field
          id="code-order"
          label="Порядок"
          type="number"
          inputMode="numeric"
          value={order}
          onChange={(e) => {
            setOrder(e.target.value);
          }}
        />
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={hidden}
            onChange={(e) => {
              setHidden(e.target.checked);
            }}
          />
          Скрыть с экрана ввода
        </label>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={busy}>
            Сохранить
          </Button>
          {code !== null && (
            <Button
              variant="ghost"
              disabled={busy || code.in_use}
              {...(code.in_use ? { title: 'Категория используется' } : {})}
              onClick={() => {
                if (!confirm) {
                  setConfirm(true);
                  return;
                }
                void (async () => {
                  const r = await remove(code.code);
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
          )}
        </div>
      </form>
    </Sheet>
  );
}
