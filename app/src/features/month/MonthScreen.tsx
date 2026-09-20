import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useGetCodesQuery, useGetMonthTxnsQuery } from '@/api/api';
import type { MonthTxn } from '@/api/types';
import { TabBar } from '@/shared/TabBar';
import { Toast } from '@/shared/Toast';
import { DayList } from './DayList';
import { EditCodeSheet } from './EditCodeSheet';
import { EditManualSheet } from './EditManualSheet';
import { MonthHeader } from './MonthHeader';
import { Summary, type SourceFilter } from './SummaryPanel';
import { monthRangeOf, parseMonth, shiftMonth } from './monthParam';
import { groupByDay, summarize, visibleRows } from './summary';
import styles from './MonthScreen.module.scss';

interface ToastState {
  message: string;
  kind: 'ok' | 'err';
}

export function MonthScreen() {
  const [params, setParams] = useSearchParams();
  const month = parseMonth(params.get('m'));
  const [filterCode, setFilterCode] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<SourceFilter>('all');
  const [editing, setEditing] = useState<MonthTxn | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const codes = useGetCodesQuery();
  const { data, isLoading, error } = useGetMonthTxnsQuery(monthRangeOf(month));
  const rows = visibleRows(data ?? []);
  const baseCurrency = rows[0]?.base_currency ?? 'USD';
  const sources = [...new Set(rows.map((r) => r.source))];
  const effectiveSource: SourceFilter = filterSource !== 'all' && sources.includes(filterSource) ? filterSource : 'all';
  const summary = summarize(effectiveSource === 'all' ? rows : rows.filter((r) => r.source === effectiveSource));
  const listed = rows.filter(
    (r) => (effectiveSource === 'all' || r.source === effectiveSource) && (filterCode === null || (r.code ?? '?') === filterCode),
  );
  const days = groupByDay(listed);

  const goTo = (ym: string) => {
    setParams({ m: ym });
    setFilterCode(null);
    setFilterSource('all');
  };

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

  const onRowClick = (txn: MonthTxn) => {
    setEditing(txn);
  };

  return (
    <main className={styles.wrap}>
      <MonthHeader
        month={month}
        onPrev={() => {
          goTo(shiftMonth(month, -1));
        }}
        onNext={() => {
          goTo(shiftMonth(month, 1));
        }}
      />
      {isLoading && <p className={styles.muted}>Загружаем…</p>}
      {error && <p className={styles.muted}>Не удалось загрузить: {error.message}</p>}
      {data && (
        <>
          <Summary
            summary={summary}
            baseCurrency={baseCurrency}
            sources={sources}
            filterCode={filterCode}
            onFilterCode={setFilterCode}
            filterSource={effectiveSource}
            onFilterSource={setFilterSource}
          />
          <DayList days={days} baseCurrency={baseCurrency} onRowClick={onRowClick} />
        </>
      )}
      {editing?.source === 'manual' && (
        <EditManualSheet
          key={editing.external_id}
          txn={editing}
          codes={codes.data}
          monthTxns={rows}
          onClose={() => {
            setEditing(null);
          }}
          onDone={(m) => {
            setEditing(null);
            show(m, 'ok');
          }}
          onError={(m) => {
            show(m, 'err');
          }}
        />
      )}
      {editing && editing.source !== 'manual' && (
        <EditCodeSheet
          key={editing.external_id}
          txn={editing}
          codes={codes.data}
          monthTxns={rows}
          onClose={() => {
            setEditing(null);
          }}
          onDone={(m) => {
            setEditing(null);
            show(m, 'ok');
          }}
          onError={(m) => {
            show(m, 'err');
          }}
        />
      )}
      <Toast message={toast?.message ?? null} kind={toast?.kind ?? 'ok'} />
      <TabBar />
    </main>
  );
}
