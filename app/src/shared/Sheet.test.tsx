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

  it('не переупорядочивает стек при ре-рендере с новым немемоизированным onClose родителя', () => {
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

    // Ре-рендер с НОВОЙ инлайн-функцией onClose у внешнего (всё ещё
    // открытого) листа имитирует немемоизированного родителя. Внутренний
    // лист остаётся открытым и должен оставаться верхним в стеке.
    const onCloseOuterNew = vi.fn();
    rerender(
      <>
        <Sheet open title="Outer" onClose={onCloseOuterNew}>
          <p>outer</p>
        </Sheet>
        <Sheet open title="Inner" onClose={onCloseInner}>
          <p>inner</p>
        </Sheet>
      </>,
    );

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCloseInner).toHaveBeenCalledTimes(1);
    expect(onCloseOuterNew).not.toHaveBeenCalled();
    expect(onCloseOuter).not.toHaveBeenCalled();
  });
});
