import type { MonthlyStat } from '@/api/types';
import { formatMonthShort } from '@/shared/format';
import { codeTrend, forecast, monthBreakdown, monthTotals, pickMonth, pluralDays, statsRange, toYM } from './stats';

describe('statsRange', () => {
  it('12 месяцев назад от текущего, включая текущий', () => {
    expect(statsRange('2026-09-20')).toEqual({ from: '2025-10-01', to: '2026-09-30' });
    expect(statsRange('2026-01-05')).toEqual({ from: '2025-02-01', to: '2026-01-31' });
  });
});

describe('formatMonthShort', () => {
  it('короткое название месяца', () => {
    expect(formatMonthShort('2026-09')).toBe('сен');
    expect(formatMonthShort('2026-01-01')).toBe('янв');
  });
});

const r = (month: string, code: string, amount: number): MonthlyStat => ({ month, code, amount, txn_count: 1 });

const rows = [
  r('2026-09-01', 'каф', 300),
  r('2026-09-01', 'прод', 150),
  r('2026-09-01', '?', 50),
  r('2026-07-01', 'каф', 45),
  r('2026-08-01', 'прод', 1000),
  r('2026-08-01', 'каф', 500),
];

describe('monthTotals', () => {
  it('по возрастанию месяца, коды суммируются', () => {
    expect(monthTotals(rows)).toEqual([
      { month: '2026-07', total: 45 },
      { month: '2026-08', total: 1500 },
      { month: '2026-09', total: 500 },
    ]);
  });
  it('пустой список → пусто', () => {
    expect(monthTotals([])).toEqual([]);
  });
});

describe('monthBreakdown', () => {
  it('по убыванию, доли в процентах', () => {
    expect(monthBreakdown(rows, '2026-09')).toEqual([
      { code: 'каф', amount: 300, share: 60 },
      { code: 'прод', amount: 150, share: 30 },
      { code: '?', amount: 50, share: 10 },
    ]);
  });
  it('"?" в конце при равенстве сумм', () => {
    const tie = [r('2026-09-01', '?', 10), r('2026-09-01', 'быт', 10)];
    expect(monthBreakdown(tie, '2026-09').map((b) => b.code)).toEqual(['быт', '?']);
  });
  it('месяц без строк → пусто', () => {
    expect(monthBreakdown(rows, '2026-06')).toEqual([]);
  });
});

describe('codeTrend', () => {
  it('нули в месяцах без кода, порядок как в months', () => {
    expect(codeTrend(rows, 'прод', ['2026-07', '2026-08', '2026-09'])).toEqual([
      { month: '2026-07', total: 0 },
      { month: '2026-08', total: 1000 },
      { month: '2026-09', total: 150 },
    ]);
  });
});

describe('forecast', () => {
  it('середина месяца', () => {
    expect(forecast(869.4, '2026-09-14')).toEqual({ daysPassed: 14, daysInMonth: 30, perDay: 62.1, projected: 1863 });
  });
  it('первое число — делим на один день', () => {
    expect(forecast(10, '2026-02-01')).toEqual({ daysPassed: 1, daysInMonth: 28, perDay: 10, projected: 280 });
  });
});

describe('toYM', () => {
  it('обрезает день', () => {
    expect(toYM('2026-09-01')).toBe('2026-09');
  });
});

describe('pickMonth', () => {
  const months = ['2026-07', '2026-08', '2026-09'];
  it('выбранный месяц есть в данных — используем его', () => {
    expect(pickMonth('2026-08', months, '2026-09')).toBe('2026-08');
  });
  it('выбранный месяц пропал из данных — откат на текущий', () => {
    expect(pickMonth('2026-08', ['2026-07', '2026-09'], '2026-09')).toBe('2026-09');
  });
  it('текущего месяца тоже нет — последний доступный', () => {
    expect(pickMonth(null, ['2026-06', '2026-07'], '2026-09')).toBe('2026-07');
  });
});

describe('pluralDays', () => {
  it('склоняет по стандартному правилу', () => {
    expect(pluralDays(1)).toBe('день');
    expect(pluralDays(2)).toBe('дня');
    expect(pluralDays(5)).toBe('дней');
    expect(pluralDays(11)).toBe('дней');
    expect(pluralDays(21)).toBe('день');
    expect(pluralDays(22)).toBe('дня');
    expect(pluralDays(25)).toBe('дней');
  });
});
