import { toAppError } from './errors';

describe('toAppError', () => {
  it('берёт message у ошибки Supabase/PostgREST', () => {
    expect(toAppError({ message: 'Сумма должна быть больше нуля', code: 'P0001' })).toEqual({
      message: 'Сумма должна быть больше нуля',
    });
  });

  it('берёт message у Error', () => {
    expect(toAppError(new Error('Failed to fetch'))).toEqual({ message: 'Нет связи с сервером' });
  });

  it('даёт общий текст для всего остального', () => {
    expect(toAppError(null)).toEqual({ message: 'Неизвестная ошибка' });
    expect(toAppError('строка')).toEqual({ message: 'строка' });
  });
});
