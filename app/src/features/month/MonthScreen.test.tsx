import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router';
import { makeStore } from '@/app/store';
import type { MonthTxn } from '@/api/types';
import { MonthScreen } from './MonthScreen';

const rpc = vi.fn();
vi.mock('@/api/supabase', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpc(...a), auth: { signOut: vi.fn(() => Promise.resolve({ error: null })) } },
}));

const codes = [
  { code: 'прод', title: 'Продукты', section: 'Базовые', sort_order: 20 },
  { code: 'каф', title: 'Кафе, рестораны', section: 'Комфорт', sort_order: 210 },
];

let n = 0;
const row = (over: Partial<MonthTxn>): MonthTxn => ({
  external_id: `id-${String(++n)}`,
  source: 'bybit_card',
  txn_date: '2026-09-19',
  txn_at: '2026-09-19T10:00:00+00:00',
  merchant_name: 'Lidl',
  amount: 10,
  currency: 'USD',
  base_amount: 10,
  base_currency: 'USD',
  code: 'прод',
  kind: 'expense',
  status: 'success',
  note: null,
  code_override: null,
  ...over,
});

const fixtures = [
  row({ external_id: 'card-1', merchant_name: 'Lidl', code: 'прод', base_amount: 10, amount: 10 }),
  row({ external_id: 'card-2', merchant_name: 'Cafe', code: 'каф', base_amount: 25, amount: 25, txn_at: '2026-09-19T12:00:00+00:00' }),
  row({ external_id: 'man-1', source: 'manual', note: 'кофе', code: 'каф', base_amount: 3, amount: 3, txn_date: '2026-09-18', txn_at: '2026-09-17T22:00:00+00:00' }),
  row({ external_id: 'cash-1', kind: 'transfer', merchant_name: 'ATM', code: null, base_amount: 100, amount: 100, txn_date: '2026-09-18', txn_at: '2026-09-18T09:00:00+00:00' }),
  row({ external_id: 'void-1', kind: 'void', status: 'failed', merchant_name: 'Declined', base_amount: 9 }),
  row({ external_id: 'nocode-1', merchant_name: 'GOG', code: null, base_amount: 4, amount: 4 }),
];

const renderAt = (path: string) =>
  render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/month" element={<MonthScreen />} />
          <Route path="/" element={<div>entry</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === 'app_codes') return Promise.resolve({ data: codes, error: null });
    if (fn === 'app_month_txns') return Promise.resolve({ data: fixtures, error: null });
    return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
  });
});

describe('MonthScreen', () => {
  it('показывает итог, категории, снятие и список по дням; отказ скрыт', async () => {
    renderAt('/month?m=2026-09');
    expect(await screen.findByRole('heading', { name: /42,00 USD/ })).toBeInTheDocument();
    expect(screen.getByText('Сентябрь 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /каф.*28,00/ })).toBeInTheDocument();
    expect(screen.getByText(/Снято наличными.*100,00 USD/)).toBeInTheDocument();
    expect(screen.getByText('19 сентября · 39,00 USD')).toBeInTheDocument();
    expect(screen.getByText('18 сентября · 3,00 USD')).toBeInTheDocument();
    expect(screen.queryByText('Declined')).not.toBeInTheDocument();
    expect(screen.getByText('наличные')).toBeInTheDocument();
  });

  it('чип «?» фильтрует список записями без кода', async () => {
    const user = userEvent.setup();
    renderAt('/month?m=2026-09');
    const totals = within(await screen.findByRole('region', { name: 'Итоги' }));
    const chip = totals.getByRole('button', { name: /\?.*4,00/ });
    await user.click(chip);
    expect(screen.getByText('GOG')).toBeInTheDocument();
    expect(screen.queryByText('Lidl')).not.toBeInTheDocument();
    expect(screen.queryByText('Cafe')).not.toBeInTheDocument();
  });

  it('тап по категории фильтрует список, повторный снимает', async () => {
    const user = userEvent.setup();
    renderAt('/month?m=2026-09');
    const chip = await screen.findByRole('button', { name: /каф.*28,00/ });
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Lidl')).not.toBeInTheDocument();
    expect(screen.getByText('Cafe')).toBeInTheDocument();
    await user.click(chip);
    expect(screen.getByText('Lidl')).toBeInTheDocument();
  });

  it('стрелка вперёд неактивна в текущем месяце, назад меняет запрос', async () => {
    const user = userEvent.setup();
    const now = new Date();
    const ym = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    renderAt(`/month?m=${ym}`);
    expect(await screen.findByRole('button', { name: 'Следующий месяц' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    const lastCall = rpc.mock.calls.at(-1) as [string, { p_from: string }] | undefined;
    expect(lastCall?.[0]).toBe('app_month_txns');
    expect(lastCall?.[1].p_from).toMatch(/-01$/);
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeEnabled();
  });

  it('фильтр источника не оставляет пустой экран при смене месяца', async () => {
    const user = userEvent.setup();
    const now = new Date();
    const ym = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const cardOnly = fixtures.filter((f) => f.source === 'bybit_card');
    rpc.mockImplementation((fn: string, args?: { p_from: string }) => {
      if (fn === 'app_codes') return Promise.resolve({ data: codes, error: null });
      if (fn === 'app_month_txns') {
        const isCurrentMonth = args?.p_from.startsWith(ym) ?? false;
        return Promise.resolve({ data: isCurrentMonth ? fixtures : cardOnly, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
    });
    renderAt(`/month?m=${ym}`);
    await user.click(await screen.findByRole('button', { name: 'вручную' }));
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    await waitFor(() => {
      expect(screen.getByText('Lidl')).toBeInTheDocument();
    });
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
  });
});

describe('MonthScreen — правка', () => {
  it('правит ручную запись через app_update_txn', async () => {
    const user = userEvent.setup();
    rpc.mockImplementation((fn: string) => {
      if (fn === 'app_codes') return Promise.resolve({ data: codes, error: null });
      if (fn === 'app_month_txns') return Promise.resolve({ data: fixtures, error: null });
      if (fn === 'app_update_txn') return Promise.resolve({ data: 'man-1', error: null });
      return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
    });
    renderAt('/month?m=2026-09');
    await user.click(await screen.findByRole('button', { name: /кофе/ }));
    const dialog = screen.getByRole('dialog', { name: 'Запись' });
    const amount = within(dialog).getByLabelText('Сумма');
    expect(amount).toHaveValue('3');
    await user.clear(amount);
    await user.type(amount, '4.5');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith(
        'app_update_txn',
        expect.objectContaining({ p_id: 'man-1', p_amount: 4.5, p_currency: 'USD', p_code: 'каф', p_note: 'кофе' }),
      ); },
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Сохранено');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('удаляет ручную запись только со второго тапа', async () => {
    const user = userEvent.setup();
    rpc.mockImplementation((fn: string) => {
      if (fn === 'app_codes') return Promise.resolve({ data: codes, error: null });
      if (fn === 'app_month_txns') return Promise.resolve({ data: fixtures, error: null });
      if (fn === 'app_delete_txn') return Promise.resolve({ data: 1, error: null });
      return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
    });
    renderAt('/month?m=2026-09');
    await user.click(await screen.findByRole('button', { name: /кофе/ }));
    const dialog = screen.getByRole('dialog', { name: 'Запись' });
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    expect(rpc).not.toHaveBeenCalledWith('app_delete_txn', expect.anything());
    await user.click(within(dialog).getByRole('button', { name: 'Точно удалить' }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith('app_delete_txn', { p_id: 'man-1' }); });
    expect(await screen.findByRole('status')).toHaveTextContent('Удалено');
  });

  it('у карточной меняет категорию через app_set_code и умеет сбросить', async () => {
    const user = userEvent.setup();
    const withOverride = fixtures.map((f) => (f.external_id === 'card-1' ? { ...f, code_override: 'прод' } : f));
    rpc.mockImplementation((fn: string) => {
      if (fn === 'app_codes') return Promise.resolve({ data: codes, error: null });
      if (fn === 'app_month_txns') return Promise.resolve({ data: withOverride, error: null });
      if (fn === 'app_set_code') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
    });
    renderAt('/month?m=2026-09');
    await user.click(await screen.findByRole('button', { name: /Lidl/ }));
    const dialog = screen.getByRole('dialog', { name: 'Категория' });
    await user.click(within(dialog).getByRole('button', { name: 'Все категории' }));
    await user.click(within(screen.getAllByRole('dialog')[1] ?? dialog).getByRole('radio', { name: 'каф' }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith('app_set_code', { p_source: 'bybit_card', p_id: 'card-1', p_code: 'каф' }); },
    );
  });

  it('кнопка сброса вызывает app_set_code с null', async () => {
    const user = userEvent.setup();
    const withOverride = fixtures.map((f) => (f.external_id === 'card-1' ? { ...f, code_override: 'прод' } : f));
    rpc.mockImplementation((fn: string) => {
      if (fn === 'app_codes') return Promise.resolve({ data: codes, error: null });
      if (fn === 'app_month_txns') return Promise.resolve({ data: withOverride, error: null });
      if (fn === 'app_set_code') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
    });
    renderAt('/month?m=2026-09');
    await user.click(await screen.findByRole('button', { name: /Lidl/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Категория' })).getByRole('button', { name: 'Сбросить на правило' }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith('app_set_code', { p_source: 'bybit_card', p_id: 'card-1', p_code: null }); },
    );
  });
});
