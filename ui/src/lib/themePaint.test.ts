// T-37: paintTheme красит <html> и НИЧЕГО не сохраняет (его зовёт слушатель
// темы ОС), applyTheme — красит и сохраняет выбор пользователя.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, paintTheme } from './theme';

function fakeStorage(): { storage: Storage; writes: string[] } {
  const writes: string[] = [];
  const storage = {
    getItem: () => null,
    setItem: (key: string, value: string) => {
      writes.push(`${key}=${value}`);
    },
  } as unknown as Storage;
  return { storage, writes };
}

function stubOsDark(dark: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) => ({ matches: dark && query === '(prefers-color-scheme: dark)', media: query }) as MediaQueryList,
  );
}

describe('paintTheme / applyTheme', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-accent');
  });

  it('paintTheme красит документ и не принимает хранилище', () => {
    stubOsDark(false);
    const res = paintTheme({ theme: 'system', accent: 'auto', doc: document, win: window });
    expect(res).toEqual({ theme: 'light', accent: 'sage' });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.accent).toBe('sage');
  });

  it('applyTheme красит так же и записывает выбор (а не вычисленную тему)', () => {
    stubOsDark(true);
    const { storage, writes } = fakeStorage();
    const res = applyTheme({ theme: 'system', accent: 'graphite', doc: document, win: window, storage });
    expect(res).toEqual({ theme: 'dark', accent: 'graphite' });
    expect(writes).toEqual(['lavray.theme=system', 'lavray.accent=graphite']);
  });
});
