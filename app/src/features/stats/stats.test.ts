import { formatMonthShort } from '@/shared/format';
import { statsRange } from './stats';

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
