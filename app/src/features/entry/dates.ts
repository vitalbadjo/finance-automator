// Все даты — локальные календарные, без времени. Пользователь в Белграде,
// база тоже считает txn_date по Europe/Belgrade, поэтому местная дата
// браузера и есть нужная.

const pad = (n: number) => String(n).padStart(2, '0');

const toISO = (d: Date) => `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const fromISO = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

export const todayISO = (): string => toISO(new Date());

export const shiftISO = (iso: string, days: number): string => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
};

export const monthRange = (iso: string): { from: string; to: string } => {
  const d = fromISO(iso);
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: toISO(from), to: toISO(to) };
};
