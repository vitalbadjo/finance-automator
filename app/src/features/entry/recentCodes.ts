const KEY = 'recentCodes';
const MAX = 8;
const FALLBACK: string[] = [];

// localStorage может быть недоступен (приватный режим, заблокированные
// данные сайта) — тогда работаем без памяти о категориях, но не падаем.
export function readRecentCodes(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return FALLBACK;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return FALLBACK;
    const list = parsed.filter((x): x is string => typeof x === 'string');
    return list.slice(0, MAX);
  } catch {
    return FALLBACK;
  }
}

export function pushRecentCode(code: string): string[] {
  const next = [code, ...readRecentCodes().filter((c) => c !== code)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* без памяти о категориях, но работаем */
  }
  return next;
}
