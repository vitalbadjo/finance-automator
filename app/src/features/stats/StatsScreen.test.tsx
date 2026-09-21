import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router';
import { makeStore } from '@/app/store';
import type { MonthlyStat } from '@/api/types';
import { StatsScreen } from './StatsScreen';

const rpc = vi.fn();
vi.mock('@/api/supabase', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpc(...a), auth: { signOut: vi.fn(() => Promise.resolve({ error: null })) } },
}));

const codes = [
  { code: 'прод', title: 'Продукты', section: 'Базовые', sort_order: 20 },
  { code: 'каф', title: 'Кафе, рестораны', section: 'Комфорт', sort_order: 210 },
];

const now = new Date();
const currentYear = now.getFullYear();
const cur = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const prev = (() => {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();

const r = (month: string, code: string, amount: number): MonthlyStat => ({ month: `${month}-01`, code, amount, txn_count: 1 });
const stats = [r(prev, 'каф', 500), r(prev, 'прод', 1000), r(cur, 'каф', 300), r(cur, 'прод', 150), r(cur, '?', 50)];
// Прошлый год: две строки в марте — использованы во втором тесте.
const prevYearStats = [r(`${String(currentYear - 1)}-03`, 'каф', 700), r(`${String(currentYear - 1)}-03`, 'прод', 800)];

const renderScreen = () =>
  render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={['/stats']}>
        <StatsScreen />
      </MemoryRouter>
    </Provider>,
  );

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((fn: string, args?: { p_from?: string }) => {
    if (fn === 'app_codes') return Promise.resolve({ data: codes, error: null });
    if (fn === 'app_monthly_stats') {
      const from = args?.p_from ?? '';
      if (from.startsWith(String(currentYear))) return Promise.resolve({ data: stats, error: null });
      if (from.startsWith(String(currentYear - 1))) return Promise.resolve({ data: prevYearStats, error: null });
      return Promise.resolve({ data: [], error: null });
    }
    return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
  });
});

describe('StatsScreen', () => {
  it('текущий месяц выбран, итог, прогноз, разбивка с названиями', async () => {
    renderScreen();
    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent(/500,00/);
    expect(screen.getByText(/к концу месяца около/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Категории' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/каф/);
    expect(items[0]).toHaveTextContent(/Кафе, рестораны/);
    expect(items[0]).toHaveTextContent(/60\s?%/);
    expect(items[0]?.querySelector('[style*="width: 60%"]')).not.toBeNull();
    expect(items[2]).toHaveTextContent(/без категории/);
  });

  it('тап по прошлому месяцу меняет итог и убирает прогноз', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole('heading', { level: 2 });
    await user.click(screen.getByRole('button', { name: /1\s?500,00/ }));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/1\s?500,00/);
    expect(screen.queryByText(/к концу месяца около/)).not.toBeInTheDocument();
  });

  it('тап по категории открывает тренд, «Назад» возвращает', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole('heading', { level: 2 });
    await user.click(screen.getByRole('button', { name: /каф.*Кафе/ }));
    expect(screen.getByText('каф по месяцам')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /: .*USD/ })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Назад к месяцу' }));
    expect(screen.getByRole('list', { name: 'Категории' })).toBeInTheDocument();
  });

  it('пустое состояние', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'app_codes') return Promise.resolve({ data: codes, error: null });
      return Promise.resolve({ data: [], error: null });
    });
    renderScreen();
    expect(await screen.findByText(`Пока нет данных за ${String(currentYear)}`)).toBeInTheDocument();
  });

  it('запрос уходит за календарный год', async () => {
    renderScreen();
    await screen.findByRole('heading', { level: 2 });
    expect(rpc).toHaveBeenCalledWith('app_monthly_stats', {
      p_from: `${String(currentYear)}-01-01`,
      p_to: `${String(currentYear)}-12-31`,
    });
  });

  it('‹ показывает прошлый год, › заблокирована в текущем', async () => {
    const user = userEvent.setup();
    let resolvePrev: (v: { data: MonthlyStat[]; error: null }) => void = () => {
      // переопределяется ниже, до использования
    };
    const prevPromise = new Promise<{ data: MonthlyStat[]; error: null }>((resolve) => {
      resolvePrev = resolve;
    });
    rpc.mockImplementation((fn: string, args?: { p_from?: string }) => {
      if (fn === 'app_codes') return Promise.resolve({ data: codes, error: null });
      if (fn === 'app_monthly_stats') {
        const from = args?.p_from ?? '';
        if (from.startsWith(String(currentYear))) return Promise.resolve({ data: stats, error: null });
        if (from.startsWith(String(currentYear - 1))) return prevPromise;
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
    });
    renderScreen();
    await screen.findByRole('heading', { level: 2 });
    expect(screen.getByRole('button', { name: 'Следующий год' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Предыдущий год' }));

    // Пока предыдущий год ещё грузится: заголовок года сменился, но
    // старый итог не должен мелькать — только «Загружаем…».
    expect(await screen.findByText(String(currentYear - 1))).toBeInTheDocument();
    expect(screen.getByText('Загружаем…')).toBeInTheDocument();
    expect(screen.queryByText(/500,00/)).not.toBeInTheDocument();

    resolvePrev({ data: prevYearStats, error: null });

    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent(/1\s?500,00/);
    expect(screen.getByText(`Март ${String(currentYear - 1)}`)).toBeInTheDocument();
    expect(screen.queryByText(/к концу месяца около/)).not.toBeInTheDocument();
  });

  it('пустой год', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole('heading', { level: 2 });
    await user.click(screen.getByRole('button', { name: 'Предыдущий год' }));
    await screen.findByText(String(currentYear - 1));
    await user.click(screen.getByRole('button', { name: 'Предыдущий год' }));
    expect(await screen.findByText(`Пока нет данных за ${String(currentYear - 2)}`)).toBeInTheDocument();
    expect(screen.getByText(String(currentYear - 2))).toBeInTheDocument();
  });
});
