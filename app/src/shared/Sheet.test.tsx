import { render } from '@testing-library/react';
import { Sheet } from './Sheet';

describe('Sheet', () => {
  it('Escape закрывает только верхний из вложенных листов', () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();

    const { rerender } = render(
      <>
        <Sheet open title="Outer" onClose={onCloseOuter}>
          <p>outer</p>
        </Sheet>
        <Sheet open title="Inner" onClose={onCloseInner}>
          <p>inner</p>
        </Sheet>
      </>,
    );

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCloseInner).toHaveBeenCalledTimes(1);
    expect(onCloseOuter).not.toHaveBeenCalled();

    rerender(
      <>
        <Sheet open title="Outer" onClose={onCloseOuter}>
          <p>outer</p>
        </Sheet>
        <Sheet open={false} title="Inner" onClose={onCloseInner}>
          <p>inner</p>
        </Sheet>
      </>,
    );

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCloseOuter).toHaveBeenCalledTimes(1);
    expect(onCloseInner).toHaveBeenCalledTimes(1);
  });
});
