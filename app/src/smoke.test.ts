describe('toolchain', () => {
  it('runs vitest with jest-dom', () => {
    const el = document.createElement('div');
    el.textContent = 'ок';
    expect(el).toHaveTextContent('ок');
  });
});
