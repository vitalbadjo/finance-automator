export type Theme = 'system' | 'light' | 'dark';

const KEY = 'theme';

const isTheme = (v: unknown): v is Theme => v === 'system' || v === 'light' || v === 'dark';

// Тема хранится только на устройстве. Недоступное хранилище (приватный
// режим, запрет на данные сайта) — не ошибка: тема живёт до перезагрузки.
export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return isTheme(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

// «Как в системе» — атрибута нет, работает prefers-color-scheme из tokens.scss.
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // хранилище недоступно — см. readTheme
  }
}
