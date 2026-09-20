import { applyTheme, readTheme } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme', () => {
  it('applyTheme ставит атрибут и пишет хранилище', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(readTheme()).toBe('dark');
  });

  it('system снимает атрибут и удаляет ключ', () => {
    applyTheme('light');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('theme')).toBeNull();
    expect(readTheme()).toBe('system');
  });

  it('readTheme даёт system при мусоре в хранилище', () => {
    localStorage.setItem('theme', 'blue');
    expect(readTheme()).toBe('system');
  });

  it('readTheme и applyTheme переживают недоступное хранилище', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readTheme()).toBe('system');
    expect(() => {
      applyTheme('dark');
    }).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    get.mockRestore();
    set.mockRestore();
  });
});
