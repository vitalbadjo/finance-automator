import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router';
import { makeStore } from '@/app/store';
import type { Settings } from '@/api/types';
import { SettingsScreen } from './SettingsScreen';

const rpc = vi.fn();
vi.mock('@/api/supabase', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpc(...a), auth: { signOut: vi.fn(() => Promise.resolve({ error: null })) } },
}));

const settings: Settings = {
  base_currency: 'USD',
  sources: [
    { code: 'bybit_card', title: 'Bybit Crypto Card', txn_count: 120, last_sync_at: '2026-09-20T18:42:00+00:00', last_sync_ok: true },
    { code: 'manual', title: 'Ручной ввод', txn_count: 3, last_sync_at: null, last_sync_ok: null },
  ],
  codes: [{ code: 'прод', title: 'Продукты', section: 'Базовые', sort_order: 20, hidden: false, in_use: true }],
  rules: [{ id: 1, pattern: 'LIDL', code: 'прод', priority: 100, note: null }],
  unmapped: [{ merchant: 'NEW SHOP', mcc: '5999', mcc_desc: null, txn_count: 2, amount: 12.5, last_seen: '2026-09-19T10:00:00+00:00' }],
};

const renderScreen = () =>
  render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/settings/codes" element={<div>codes page</div>} />
          <Route path="/settings/rules" element={<div>rules page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === 'app_settings') return Promise.resolve({ data: settings, error: null });
    if (fn === 'app_source_rename') return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
  });
});

describe('SettingsScreen', () => {
  it('тема: три кнопки, активная из хранилища, тап применяет', async () => {
    localStorage.setItem('theme', 'dark');
    renderScreen();
    const group = screen.getByRole('radiogroup', { name: 'Тема' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(within(group).getByRole('radio', { name: 'Тёмная' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(group).getByRole('radio', { name: 'Светлая' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('валюта без контролов, источники со статусом, ссылки на подэкраны', async () => {
    renderScreen();
    expect(await screen.findByText('USD')).toBeInTheDocument();
    expect(screen.getByText('Меняется вместе с курсами, отдельной задачей')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /валюта/i })).not.toBeInTheDocument();
    const card = screen.getByRole('button', { name: /Bybit Crypto Card/ });
    expect(card).toHaveTextContent('записей: 120');
    expect(card).toHaveTextContent(/синхронизация 20 сентября/);
    expect(screen.getByRole('button', { name: /Ручной ввод/ })).toHaveTextContent('—');
    expect(screen.getByRole('link', { name: /Категории/ })).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: /Правила по мерчантам/ })).toHaveTextContent('без категории: 1');
  });

  it('ошибка синхронизации у источника', async () => {
    const [card] = settings.sources;
    if (!card) throw new Error('fixture');
    rpc.mockImplementation((fn: string) =>
      fn === 'app_settings'
        ? Promise.resolve({
            data: { ...settings, sources: [{ ...card, last_sync_ok: false }] },
            error: null,
          })
        : Promise.resolve({ data: null, error: { message: 'нет' } }),
    );
    renderScreen();
    expect(await screen.findByRole('button', { name: /Bybit/ })).toHaveTextContent('ошибка синхронизации');
  });

  it('переименование источника вызывает app_source_rename и показывает тост', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /Ручной ввод/ }));
    const dialog = screen.getByRole('dialog', { name: 'Источник' });
    const input = within(dialog).getByLabelText('Название');
    await userEvent.clear(input);
    await userEvent.type(input, 'Наличные');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('app_source_rename', { p_code: 'manual', p_title: 'Наличные' });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Сохранено');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ошибка сервера при переименовании остаётся в шторке', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'app_settings') return Promise.resolve({ data: settings, error: null });
      return Promise.resolve({ data: null, error: { message: 'Введите название' } });
    });
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /Ручной ввод/ }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Введите название');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
