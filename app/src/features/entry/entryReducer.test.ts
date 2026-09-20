import { entryReducer, initialEntry } from './entryReducer';

describe('entryReducer', () => {
  const base = initialEntry('RSD', '2026-09-19');

  it('меняет поля по одному', () => {
    const s = entryReducer(base, { type: 'amount', value: '350' });
    expect(s.amount).toBe('350');
    expect(entryReducer(s, { type: 'code', value: 'каф' }).code).toBe('каф');
  });

  it('после сохранения очищает сумму и заметку, остальное оставляет', () => {
    let s = base;
    s = entryReducer(s, { type: 'amount', value: '350' });
    s = entryReducer(s, { type: 'code', value: 'каф' });
    s = entryReducer(s, { type: 'note', value: 'кофе' });
    s = entryReducer(s, { type: 'date', value: '2026-09-18' });
    s = entryReducer(s, { type: 'saved' });
    expect(s).toEqual({ amount: '', note: '', code: 'каф', currency: 'RSD', date: '2026-09-18' });
  });
});
