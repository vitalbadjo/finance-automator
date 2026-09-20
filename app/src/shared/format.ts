export const formatMoney = (amount: number, currency: string): string =>
  `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} ${currency}`;

export const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const MONTHS_NOM = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];
const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

// «Сентябрь 2026» из YYYY-MM
export const formatMonthTitle = (ym: string): string => {
  const [y, m] = ym.split('-');
  return `${MONTHS_NOM[Number(m) - 1] ?? m ?? ''} ${y ?? ''}`;
};

// «19 сентября» из YYYY-MM-DD
export const formatDayTitle = (iso: string): string => {
  const [, m, d] = iso.split('-');
  return `${String(Number(d))} ${MONTHS_GEN[Number(m) - 1] ?? m ?? ''}`;
};
