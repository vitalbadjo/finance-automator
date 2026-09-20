import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router';
import { makeStore } from '@/app/store';
import type { Settings } from '@/api/types';
import { RulesScreen } from './RulesScreen';

const rpc = vi.fn();
vi.mock('@/api/supabase', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpc(...a), auth: { signOut: vi.fn(() => Promise.resolve({ error: null })) } },
}));

const settings: Settings = {
  base_currency: 'USD',
  sources: [],
  codes: [
    { code: 'прод', title: 'Продукты', section: 'Базовые', sort_order: 20, hidden: false, in_use: true },
    { code: 'каф', title: 'Кафе', section: 'Комфорт', sort_order: 210, hidden: false, in_use: true },
  ],
  rules: [
    { id: 1, pattern: 'LIDL', code: 'прод', priority: 100, note: null },
    { id: 2, pattern: 'BURGER', code: 'каф', priority: 50, note: 'бургерная' },
  ],
  unmapped: [
    { merchant: 'NEW_SHOP 12', mcc: '5999', mcc_desc: 'Misc', txn_count: 2, amount: 12.5, last_seen: '2026-09-19T10:00:00+00:00' },
  ],
};

let current = settings;
const renderScreen = () =>
  render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={['/settings/rules']}>
        <RulesScreen />
      </MemoryRouter>
    </Provider>,
  );

beforeEach(() => {
  current = settings;
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === 'app_settings') return Promise.resolve({ data: current, error: null });
    if (fn === 'app_rule_upsert') return Promise.resolve({ data: 3, error: null });
    if (fn === 'app_rule_delete') return Promise.resolve({ data: 1, error: null });
    return Promise.resolve({ data: null, error: { message: `нет функции ${fn}` } });
  });
});

describe('RulesScreen', () => {
  it('блок «Без категории» и правила в порядке применения', async () => {
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Без категории' })).toBeInTheDocument();
    const un = screen.getByRole('button', { name: /NEW_SHOP 12/ });
    expect(un).toHaveTextContent('5999');
    expect(un).toHaveTextContent('2 · 12,50 USD');
    const rules = screen.getAllByRole('button', { name: /^(LIDL|BURGER)/ }).map((b) => b.textContent);
    expect(rules[0]).toContain('BURGER');
    expect(rules[0]).toContain('каф · Кафе');
    expect(rules[1]).toContain('LIDL');
  });

  it('тап по мерчанту заполняет шаблон без подстановочных знаков; сохранение с p_id null', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /NEW_SHOP 12/ }));
    const dialog = screen.getByRole('dialog', { name: 'Новое правило' });
    expect(within(dialog).getByLabelText('Шаблон')).toHaveValue('NEWSHOP 12');
    await userEvent.selectOptions(within(dialog).getByLabelText('Категория'), 'каф');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('app_rule_upsert', {
        p_id: null, p_pattern: 'NEWSHOP 12', p_code: 'каф', p_priority: 100, p_note: null,
      });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Сохранено');
  });

  it('правка существующего с p_id и заметкой', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^LIDL/ }));
    const dialog = screen.getByRole('dialog', { name: 'LIDL' });
    const prio = within(dialog).getByLabelText('Приоритет');
    await userEvent.clear(prio);
    await userEvent.type(prio, '20');
    await userEvent.type(within(dialog).getByLabelText('Заметка'), 'сеть');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('app_rule_upsert', {
        p_id: 1, p_pattern: 'LIDL', p_code: 'прод', p_priority: 20, p_note: 'сеть',
      });
    });
  });

  it('удаление с подтверждением', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^LIDL/ }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Точно удалить' }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('app_rule_delete', { p_id: 1 });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Удалено');
  });

  it('пустой «Приоритет» не уходит на сервер', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^LIDL/ }));
    const dialog = screen.getByRole('dialog', { name: 'LIDL' });
    const prio = within(dialog).getByLabelText('Приоритет');
    await userEvent.clear(prio);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Введите число');
    expect(rpc).not.toHaveBeenCalledWith('app_rule_upsert', expect.anything());
  });

  it('без категории не выбрана — сохранение не уходит на сервер', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: 'Добавить' }));
    const dialog = screen.getByRole('dialog', { name: 'Новое правило' });
    await userEvent.type(within(dialog).getByLabelText('Шаблон'), 'X');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Выберите категорию');
    expect(rpc).not.toHaveBeenCalledWith('app_rule_upsert', expect.anything());
  });

  it('пустые состояния', async () => {
    current = { ...settings, rules: [], unmapped: [] };
    renderScreen();
    expect(await screen.findByText('Правил пока нет')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Без категории' })).not.toBeInTheDocument();
  });
});
