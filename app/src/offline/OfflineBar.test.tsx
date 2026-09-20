import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { makeStore } from '@/app/store';
import { pendingSet } from './state';
import type { QueuedTxn } from './types';
import { OfflineBar } from './OfflineBar';

const rpc = vi.fn();
vi.mock('@/api/supabase', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpc(...a), auth: { signOut: vi.fn() } },
}));

const q = (id: string, error: string | null = null): QueuedTxn => ({
  id,
  args: { date: '2026-09-20', amount: 5, currency: 'USD', code: 'каф', note: 'кофе' },
  createdAt: '2026-09-20T09:00:00Z',
  attempts: 0,
  error,
});

const renderBar = (items: QueuedTxn[]) => {
  const store = makeStore();
  store.dispatch(pendingSet(items));
  render(
    <Provider store={store}>
      <OfflineBar />
    </Provider>,
  );
  return store;
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: 'uuid', error: null });
});

describe('OfflineBar', () => {
  it('скрыта, когда очередь пуста', () => {
    renderBar([]);
    expect(screen.queryByText(/Не отправлено/)).not.toBeInTheDocument();
  });

  it('показывает счётчик и отправляет по тапу', async () => {
    const user = userEvent.setup();
    renderBar([q('1'), q('2')]);
    const bar = screen.getByRole('button', { name: /Не отправлено: 2/ });
    await user.click(bar);
    expect(rpc).toHaveBeenCalled();
  });

  it('при отказе открывает список с текстом ошибки и удалением', async () => {
    const user = userEvent.setup();
    const store = renderBar([q('1', 'Неизвестная категория: ххх')]);
    await user.click(screen.getByRole('button', { name: /Не отправлено: 1/ }));
    const dialog = screen.getByRole('dialog', { name: 'Не отправлено' });
    expect(within(dialog).getByText(/Неизвестная категория: ххх/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    expect(store.getState().offline.pending).toHaveLength(0);
  });
});
