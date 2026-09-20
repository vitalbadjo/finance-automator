import { isCurrentMonth, monthRangeOf, parseMonth, shiftMonth } from './monthParam';
import { todayISO } from '@/features/entry/dates';

describe('monthParam', () => {
  const current = todayISO().slice(0, 7);

  it('parseMonth принимает YYYY-MM, иначе текущий месяц', () => {
    expect(parseMonth('2026-08')).toBe('2026-08');
    expect(parseMonth('2026-13')).toBe(current);
    expect(parseMonth('abc')).toBe(current);
    expect(parseMonth(null)).toBe(current);
  });

  it('shiftMonth переходит через год', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('isCurrentMonth и monthRangeOf', () => {
    expect(isCurrentMonth(current)).toBe(true);
    expect(isCurrentMonth(shiftMonth(current, -1))).toBe(false);
    expect(monthRangeOf('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});
