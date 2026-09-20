import type { AppError } from './types';

const hasMessage = (e: unknown): e is { message: string } =>
  typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string';

// Сетевые ошибки fetch приходят как Error('Failed to fetch')
// (в браузере обычно TypeError, но проверяем по Error, чтобы не зависеть от подкласса) —
// пользователю это ни о чём, переводим в понятный текст.
const isNetworkError = (e: unknown): boolean => e instanceof Error && /fetch/i.test(e.message);

export const NETWORK_ERROR = 'Нет связи с сервером';

// Временные ошибки не означают отказ базы: запись остаётся в очереди,
// а чтение можно отдать из кэша.
export const isTransient = (e: AppError): boolean => e.transient === true || e.message === NETWORK_ERROR;

export function toAppError(e: unknown): AppError {
  if (isNetworkError(e)) return { message: NETWORK_ERROR };
  if (hasMessage(e) && e.message.trim() !== '') return { message: e.message };
  if (typeof e === 'string' && e.trim() !== '') return { message: e };
  return { message: 'Неизвестная ошибка' };
}
