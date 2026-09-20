import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router';
import { makeStore } from '@/app/store';
import type { Settings } from '@/api/types';
import { CodesScreen } from './CodesScreen';

const rpc = vi.fn();
vi.mock('@/api/supabase', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpc(...a), auth: { signOut: vi.fn(() => Promise.resolve({ error: null })) } },
}));

const settings: Settings = {
  base_currency: 'USD',
  sources: [],
  codes: [
    { code: 'прод', title: 'Продукты', section: 'Базовые', sort_order: 20, hidden: false, in_use: true },
    { code: 'каф', title: 'Кафе', section: 'Комфорт', sort_order: 210, hidden: false, in_use: false },
    { code: 'стар', title: 'Старое', section: 'Комфорт', sort_order: 5, hidden: true, in_use: false },
  ],
  rules: [],
  unmapped: [],
};

const renderScreen = () =>
  render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={['/settings/codes']}>
        <CodesScreen />
      </MemoryRouter>
    </Provider>,
  );

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === 'app_settings') return Promise.resolve({ data: settings, error: null });
    if (fn === 'app_code_upsert') return Promise.resolve({ data: 'x', error: null });
    if (fn === 'app_code_delete') return Promise.resolve({ data: 1, error: null });
    return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
  });
});

describe('CodesScreen', () => {
  it('список по разделам, скрытая в конце с подписью', async () => {
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Категории' })).toBeInTheDocument();
    const headings = (await screen.findAllByRole('heading', { level: 2 })).map((h) => h.textContent);
    expect(headings).toEqual(['Базовые', 'Комфорт']);
    const rows = screen.getAllByRole('button', { name: /^(прод|каф|стар)/ }).map((b) => b.textContent);
    expect(rows[0]).toContain('прод');
    expect(rows[1]).toContain('каф');
    expect(rows[2]).toContain('стар');
    expect(rows[2]).toContain('скрыта');
  });

  it('правка: код заголовком, сохранение вызывает app_code_upsert', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^каф/ }));
    const dialog = screen.getByRole('dialog', { name: 'каф' });
    expect(within(dialog).queryByLabelText('Код')).not.toBeInTheDocument();
    const title = within(dialog).getByLabelText('Название');
    await userEvent.clear(title);
    await userEvent.type(title, 'Кафе и бары');
    await userEvent.selectOptions(within(dialog).getByLabelText('Раздел'), 'Путешествия');
    await userEvent.click(within(dialog).getByLabelText('Скрыть с экрана ввода'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('app_code_upsert', {
        p_code: 'каф', p_title: 'Кафе и бары', p_section: 'Путешествия', p_sort_order: 210, p_hidden: true,
      });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Сохранено');
  });

  it('создание: поле кода есть, сохранение с новым кодом', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: 'Добавить' }));
    const dialog = screen.getByRole('dialog', { name: 'Новая категория' });
    await userEvent.type(within(dialog).getByLabelText('Код'), 'спорт');
    await userEvent.type(within(dialog).getByLabelText('Название'), 'Спорт');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('app_code_upsert', {
        p_code: 'спорт', p_title: 'Спорт', p_section: 'Базовые', p_sort_order: 100, p_hidden: false,
      });
    });
  });

  it('удаление недоступно у используемой, у свободной — с подтверждением', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^прод/ }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить' })).toBeDisabled();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Закрыть' }));
    await userEvent.click(screen.getByRole('button', { name: /^каф/ }));
    const del = within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить' });
    expect(del).toBeEnabled();
    await userEvent.click(del);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Точно удалить' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('app_code_delete', { p_code: 'каф' });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Удалено');
  });

  it('создание с уже существующим кодом не уходит на сервер', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: 'Добавить' }));
    const dialog = screen.getByRole('dialog', { name: 'Новая категория' });
    await userEvent.type(within(dialog).getByLabelText('Код'), 'каф');
    await userEvent.type(within(dialog).getByLabelText('Название'), 'Кафе 2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Такой код уже есть');
    expect(rpc).not.toHaveBeenCalledWith('app_code_upsert', expect.anything());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('пустой «Порядок» не уходит на сервер', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^каф/ }));
    const dialog = screen.getByRole('dialog', { name: 'каф' });
    const order = within(dialog).getByLabelText('Порядок');
    await userEvent.clear(order);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Введите число');
    expect(rpc).not.toHaveBeenCalledWith('app_code_upsert', expect.anything());
  });

  it('ошибка удаления снимает подтверждение', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'app_settings') return Promise.resolve({ data: settings, error: null });
      if (fn === 'app_code_delete') return Promise.resolve({ data: null, error: { message: 'Категория используется' } });
      return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
    });
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^каф/ }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Точно удалить' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Категория используется');
    expect(within(dialog).getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
  });

  it('ошибка сервера в тосте, шторка остаётся', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'app_settings') return Promise.resolve({ data: settings, error: null });
      return Promise.resolve({ data: null, error: { message: 'Неверный код' } });
    });
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: 'Добавить' }));
    await userEvent.type(within(screen.getByRole('dialog')).getByLabelText('Название'), 'X');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Неверный код');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
