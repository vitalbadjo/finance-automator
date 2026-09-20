import { NETWORK_ERROR, isTransient, toAppError } from './errors';

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

describe('isTransient', () => {
  it('временные — обрыв связи и всё, что помечено transient', () => {
    expect(isTransient({ message: NETWORK_ERROR })).toBe(true);
    expect(isTransient({ message: 'JWT expired', transient: true })).toBe(true);
  });

  it('отказ базы временным не считается', () => {
    expect(isTransient({ message: 'Неизвестная категория: ххх' })).toBe(false);
  });
});
