export const formatMoney = (amount: number, currency: string): string =>
  `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} ${currency}`;

export const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
