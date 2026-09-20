import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router';
import { makeStore } from '@/app/store';
import { EntryScreen } from './EntryScreen';

const rpc = vi.fn();
vi.mock('@/api/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]): unknown => rpc(...a),
    auth: { signOut: vi.fn(() => Promise.resolve()) },
  },
}));

const codes = [
  { code: 'каф', title: 'Кафе, рестораны', section: 'Комфорт', sort_order: 210 },
  { code: 'прод', title: 'Продукты', section: 'Базовые', sort_order: 20 },
];

const renderScreen = () => {
  const store = makeStore();
  render(
    <Provider store={store}>
      <MemoryRouter>
        <EntryScreen />
      </MemoryRouter>
    </Provider>,
  );
  return store;
};

beforeEach(() => {
  rpc.mockReset();
  localStorage.clear();
  rpc.mockImplementation((fn: string) => {
    if (fn === 'app_codes') return Promise.resolve({ data: codes, error: null });
    if (fn === 'app_month_txns') return Promise.resolve({ data: [], error: null });
    if (fn === 'app_add_txn') return Promise.resolve({ data: 'uuid-1', error: null });
    return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
  });
});

describe('EntryScreen', () => {
  it('сохраняет запись и очищает сумму, оставляя категорию', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(await screen.findByLabelText('Сумма'), '350');
    await user.click(await screen.findByRole('button', { name: 'Все категории' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'каф' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith(
        'app_add_txn',
        expect.objectContaining({ p_amount: 350, p_currency: 'USD', p_code: 'каф', p_note: null }),
      );
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Записано');
    expect(screen.getByLabelText('Сумма')).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'каф' })).toHaveAttribute('aria-checked', 'true');
  });

  it('при ошибке показывает текст и не теряет введённое', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'app_codes') return Promise.resolve({ data: codes, error: null });
      if (fn === 'app_month_txns') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: { message: 'Сумма должна быть больше нуля' } });
    });
    const user = userEvent.setup();
    const store = renderScreen();
    await user.type(await screen.findByLabelText('Сумма'), '12');
    await user.click(await screen.findByRole('button', { name: 'Все категории' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'прод' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Сумма должна быть больше нуля');
    expect(screen.getByLabelText('Сумма')).toHaveValue('12');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled();
    // Отказ сервера — не «не отправлено»: запись не должна остаться в очереди.
    expect(store.getState().offline.pending).toHaveLength(0);
    expect(screen.queryByText(/Не отправлено/)).not.toBeInTheDocument();
  });

  it('показывает ошибку, если запись не удалось даже поставить в очередь', async () => {
    const user = userEvent.setup();
    const store = renderScreen();
    await user.type(await screen.findByLabelText('Сумма'), '7');
    await user.click(await screen.findByRole('button', { name: 'Все категории' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'каф' }));

    const real = crypto.getRandomValues.bind(crypto);
    const realUuid = crypto.randomUUID.bind(crypto);
    try {
      // @ts-expect-error — окружение без crypto: enqueueTxn падает целиком
      crypto.randomUUID = undefined;
      crypto.getRandomValues = () => {
        throw new Error('crypto недоступен');
      };
      await user.click(screen.getByRole('button', { name: 'Сохранить' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Не удалось сохранить');
    } finally {
      crypto.getRandomValues = real;
      crypto.randomUUID = realUuid;
    }
    expect(screen.getByLabelText('Сумма')).toHaveValue('7');
    expect(store.getState().offline.pending).toHaveLength(0);
  });

  it('не даёт сохранить без категории', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(await screen.findByLabelText('Сумма'), '5');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('добавляет новую валюту через «+» и сохраняет с ней', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Добавить валюту' }));
    await user.type(screen.getByLabelText('Новая валюта'), 'rsd');
    await user.click(screen.getByRole('button', { name: 'ОК' }));
    expect(screen.getByRole('radio', { name: 'RSD' })).toHaveAttribute('aria-checked', 'true');

    await user.type(screen.getByLabelText('Сумма'), '100');
    await user.click(await screen.findByRole('button', { name: 'Все категории' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'каф' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('app_add_txn', expect.objectContaining({ p_currency: 'RSD' }));
    });
  });

  it('показывает частые категории чипами и выбирает их без открытия листа', async () => {
    const monthTxns = [
      {
        external_id: '1',
        source: 'manual',
        txn_date: '2026-09-01',
        txn_at: '2026-09-01T00:00:00Z',
        merchant_name: null,
        amount: 10,
        currency: 'USD',
        base_amount: 10,
        base_currency: 'USD',
        code: 'прод',
        kind: 'expense',
        status: 'posted',
        note: null,
        code_override: null,
      },
      {
        external_id: '2',
        source: 'manual',
        txn_date: '2026-09-02',
        txn_at: '2026-09-02T00:00:00Z',
        merchant_name: null,
        amount: 20,
        currency: 'USD',
        base_amount: 20,
        base_currency: 'USD',
        code: 'прод',
        kind: 'expense',
        status: 'posted',
        note: null,
        code_override: null,
      },
      {
        external_id: '3',
        source: 'manual',
        txn_date: '2026-09-03',
        txn_at: '2026-09-03T00:00:00Z',
        merchant_name: null,
        amount: 30,
        currency: 'USD',
        base_amount: 30,
        base_currency: 'USD',
        code: 'каф',
        kind: 'expense',
        status: 'posted',
        note: null,
        code_override: null,
      },
    ];
    rpc.mockImplementation((fn: string) => {
      if (fn === 'app_codes') return Promise.resolve({ data: codes, error: null });
      if (fn === 'app_month_txns') return Promise.resolve({ data: monthTxns, error: null });
      return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
    });
    const user = userEvent.setup();
    renderScreen();
    await screen.findByLabelText('Сумма');

    const categoryGroup = await screen.findByRole('radiogroup', { name: 'Категория' });
    const names = within(categoryGroup)
      .getAllByRole('radio')
      .map((r) => r.textContent);
    expect(names.indexOf('прод')).toBeLessThan(names.indexOf('каф'));

    await user.click(within(categoryGroup).getByRole('radio', { name: 'прод' }));
    expect(within(categoryGroup).getByRole('radio', { name: 'прод' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('без сети (status 0) сохраняет в очередь и показывает счётчик', async () => {
    const user = userEvent.setup();
    rpc.mockImplementation((fn: string) => {
      if (fn === 'app_codes') return Promise.resolve({ data: codes, error: null });
      if (fn === 'app_month_txns') return Promise.resolve({ data: [], error: null });
      // Настоящий ответ supabase-js при обрыве связи: не исключение, а status 0.
      return Promise.resolve({
        data: null,
        error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' },
        status: 0,
      });
    });
    renderScreen();
    await user.type(await screen.findByLabelText('Сумма'), '350');
    await user.click(await screen.findByRole('button', { name: 'Все категории' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'каф' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Записано');
    expect(screen.getByRole('button', { name: /Не отправлено: 1/ })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Сегодня' })).getByText(/не отправлено/)).toBeInTheDocument();
  });
});
