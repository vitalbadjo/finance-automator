const KEY = 'recentCurrencies';
const MAX = 3;
const FALLBACK = ['USD'];

// localStorage может быть недоступен (приватный режим, заблокированные
// данные сайта) — тогда работаем без памяти о валютах, но не падаем.
export function readRecentCurrencies(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return FALLBACK;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return FALLBACK;
    const list = parsed.filter((x): x is string => typeof x === 'string' && /^[A-Z]{3}$/.test(x));
    return list.length > 0 ? list.slice(0, MAX) : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export function pushRecentCurrency(code: string): string[] {
  const next = [code, ...readRecentCurrencies().filter((c) => c !== code)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* без памяти о валютах, но работаем */
  }
  return next;
}
