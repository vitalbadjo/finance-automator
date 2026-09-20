import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarChart } from './BarChart';

const items = [
  { key: '2026-07', label: 'июл', value: 45 },
  { key: '2026-08', label: 'авг', value: 1500 },
  { key: '2026-09', label: 'сен', value: 500 },
];

describe('BarChart', () => {
  it('по столбцу на элемент, активный отмечен, значение над активным', () => {
    render(<BarChart items={items} activeKey="2026-09" onSelect={vi.fn()} formatValue={(v) => `${String(v)} USD`} />);
    const bars = screen.getAllByRole('button');
    expect(bars).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'сен: 500 USD' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'авг: 1500 USD' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('500 USD')).toBeInTheDocument();
    expect(screen.queryByText('1500 USD')).not.toBeInTheDocument();
  });

  it('тап вызывает onSelect с ключом', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<BarChart items={items} activeKey={null} onSelect={onSelect} formatValue={String} />);
    await user.click(screen.getByRole('button', { name: 'авг: 1500' }));
    expect(onSelect).toHaveBeenCalledWith('2026-08');
  });

  it('пустой список → ничего', () => {
    const { container } = render(<BarChart items={[]} activeKey={null} onSelect={vi.fn()} formatValue={String} />);
    expect(container).toBeEmptyDOMElement();
  });
});
