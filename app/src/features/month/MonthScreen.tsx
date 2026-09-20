import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useGetMonthTxnsQuery } from '@/api/api';
import type { MonthTxn } from '@/api/types';
import { TabBar } from '@/shared/TabBar';
import { DayList } from './DayList';
import { MonthHeader } from './MonthHeader';
import { Summary, type SourceFilter } from './SummaryPanel';
import { monthRangeOf, parseMonth, shiftMonth } from './monthParam';
import { groupByDay, summarize, visibleRows } from './summary';
import styles from './MonthScreen.module.scss';

export function MonthScreen() {
  const [params, setParams] = useSearchParams();
  const month = parseMonth(params.get('m'));
  const [filterCode, setFilterCode] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<SourceFilter>('all');

  const { data, isLoading, error } = useGetMonthTxnsQuery(monthRangeOf(month));
  const rows = visibleRows(data ?? []);
  const baseCurrency = rows[0]?.base_currency ?? 'USD';
  const sources = [...new Set(rows.map((r) => r.source))];
  const summary = summarize(filterSource === 'all' ? rows : rows.filter((r) => r.source === filterSource));
  const listed = rows.filter(
    (r) => (filterSource === 'all' || r.source === filterSource) && (filterCode === null || r.code === filterCode),
  );
  const days = groupByDay(listed);

  const goTo = (ym: string) => {
    setParams({ m: ym });
    setFilterCode(null);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- заглушка, шторки правки добавит задача 6
  const onRowClick = (_txn: MonthTxn) => {
    /* шторки правки — задача 6 */
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
            filterSource={filterSource}
            onFilterSource={setFilterSource}
          />
          <DayList days={days} baseCurrency={baseCurrency} onRowClick={onRowClick} />
        </>
      )}
      <TabBar />
    </main>
  );
}
