import { useState } from 'react';
import { useGetCodesQuery, useGetMonthlyStatsQuery } from '@/api/api';
import { BarChart } from '@/shared/BarChart';
import { Button } from '@/shared/Button';
import { TabBar } from '@/shared/TabBar';
import { formatMoney, formatMonthShort, formatMonthTitle } from '@/shared/format';
import { todayISO } from '@/features/entry/dates';
import { Breakdown } from './Breakdown';
import { Forecast } from './Forecast';
import { codeTrend, monthBreakdown, monthTotals, pickMonth, statsRange } from './stats';
import styles from './StatsScreen.module.scss';

// Ответ app_monthly_stats не содержит код базовой валюты, а отдельный
// запрос ради одного кода не стоит того. Базовая валюта сейчас USD
// (spend.app_config); переезд на настройку — задача «Настройки».
const BASE_CURRENCY = 'USD';

export function StatsScreen() {
  const today = todayISO();
  const currentMonth = today.slice(0, 7);
  const { data, isLoading, error } = useGetMonthlyStatsQuery(statsRange(today));
  const codes = useGetCodesQuery();
  const [selected, setSelected] = useState<string | null>(null);
  const [trendCode, setTrendCode] = useState<string | null>(null);

  const rows = data ?? [];
  const totals = monthTotals(rows);
  const months = totals.map((t) => t.month);
  const month = pickMonth(selected, months, currentMonth);
  const total = totals.find((t) => t.month === month)?.total ?? 0;
  const titles = new Map((codes.data ?? []).map((c) => [c.code, c.title] as const));
  const fmt = (v: number) => formatMoney(v, BASE_CURRENCY);

  return (
    <main className={styles.wrap}>
      <h1 className={styles.title}>Статистика</h1>
      {isLoading && <p className={styles.muted}>Загружаем…</p>}
      {error && <p className={styles.muted}>Не удалось загрузить: {error.message}</p>}
      {data && totals.length === 0 && <p className={styles.muted}>Пока нет данных ни за один месяц</p>}
      {data && totals.length > 0 && trendCode === null && (
        <>
          <div>
            <h2 className={styles.total}>{fmt(total)}</h2>
            <p className={styles.muted}>{formatMonthTitle(month)}</p>
          </div>
          <BarChart
            items={totals.map((t) => ({ key: t.month, label: formatMonthShort(t.month), value: t.total }))}
            activeKey={month}
            onSelect={setSelected}
            formatValue={fmt}
          />
          {month === currentMonth && <Forecast total={total} todayISO={today} baseCurrency={BASE_CURRENCY} />}
          <Breakdown rows={monthBreakdown(rows, month)} titles={titles} baseCurrency={BASE_CURRENCY} onSelect={setTrendCode} />
        </>
      )}
      {data && trendCode !== null && (
        <>
          <div className={styles.trendHead}>
            <h2 className={styles.title}>{trendCode} по месяцам</h2>
            <Button
              variant="ghost"
              onClick={() => {
                setTrendCode(null);
              }}
            >
              Назад к месяцу
            </Button>
          </div>
          <BarChart
            items={codeTrend(rows, trendCode, months).map((t) => ({ key: t.month, label: formatMonthShort(t.month), value: t.total }))}
            activeKey={month}
            onSelect={(key) => {
              setSelected(key);
              setTrendCode(null);
            }}
            formatValue={fmt}
          />
        </>
      )}
      <TabBar />
    </main>
  );
}
