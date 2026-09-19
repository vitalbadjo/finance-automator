import { monthRange, shiftISO, todayISO } from './dates';

describe('dates', () => {
  it('todayISO даёт локальную дату в формате YYYY-MM-DD', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shiftISO сдвигает через границу месяца', () => {
    expect(shiftISO('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftISO('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('monthRange даёт первый и последний день месяца', () => {
    expect(monthRange('2026-09-19')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthRange('2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});
