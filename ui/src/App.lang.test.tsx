// SPDX-License-Identifier: GPL-3.0-only

// T-37 (C1-01): язык, выбранный в прошлый раз (localStorage `lavray.lang`),
// должен применяться при запуске — и до первого рендера, а не после него.
// Раньше App.tsx читал `lavray.lang` только чтобы проверить на null: ветки
// «язык сохранён» не было, интерфейс стартовал на английском (lib/i18n.ts:
// `let current: Language = 'en'`), пока язык не выбирали заново.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import App from './App';
import { getLanguage, setLanguage } from './lib/i18n';

function stubMatchMedia(): void {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    return {
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList;
  });
}

function setActEnvironment(on: boolean): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = on;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function sidebarLabels(): (string | null)[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.sb-item')).map((b) => b.textContent);
}

describe('T-37: язык при запуске', () => {
  let root: Root | null = null;
  let host: HTMLDivElement;

  /** «Холодный старт»: состояние модуля i18n — 'en', в хранилище лежит выбор прошлого запуска. */
  function coldStart(opts: { saved?: string; search?: string; navigatorLanguages?: string[] }): void {
    Object.defineProperty(navigator, 'languages', {
      value: opts.navigatorLanguages ?? ['en-US'],
      configurable: true,
    });
    window.localStorage.clear();
    if (opts.saved !== undefined) window.localStorage.setItem('lavray.lang', opts.saved);
    window.localStorage.setItem('lavray.onboarded', '1');
    window.history.replaceState({}, '', `/${opts.search ?? ''}`);
    window.location.hash = '';
    document.documentElement.lang = '';
    setLanguage('en');
  }

  async function mountApp(): Promise<void> {
    await act(async () => {
      root?.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
      await sleep(80);
    });
  }

  beforeEach(() => {
    setActEnvironment(true);
    stubMatchMedia();
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    vi.restoreAllMocks();
    setActEnvironment(false);
  });

  it('сохранённый язык (de) применяется при следующем запуске', async () => {
    coldStart({ saved: 'de' });
    await mountApp();
    expect(getLanguage()).toBe('de');
    expect(sidebarLabels()[0]).toBe('Verbindung');
    expect(document.documentElement.lang).toBe('de');
  });

  it('язык применён уже при первом рендере, а не эффектом после него', () => {
    coldStart({ saved: 'de' });
    // renderToString выполняет только фазу рендера (эффекты не запускаются)
    const html = renderToString(<App />);
    expect(html).toContain('Verbindung');
    expect(html).not.toContain('>Connection<');
  });

  it('первый запуск: язык берётся из системы и сохраняется', async () => {
    coldStart({ navigatorLanguages: ['ru-RU'] });
    await mountApp();
    expect(getLanguage()).toBe('ru');
    expect(sidebarLabels()[0]).toBe('Подключение');
    expect(window.localStorage.getItem('lavray.lang')).toBe('ru');
  });

  it('?lang= имеет приоритет для предпросмотра и не затирает сохранённый выбор', async () => {
    coldStart({ saved: 'de', search: '?lang=es' });
    await mountApp();
    expect(getLanguage()).toBe('es');
    expect(sidebarLabels()[0]).toBe('Conexión');
    expect(window.localStorage.getItem('lavray.lang')).toBe('de');
  });

  it('мусор в хранилище игнорируется: язык определяется по системе', async () => {
    coldStart({ saved: 'xx', navigatorLanguages: ['zh-CN'] });
    await mountApp();
    expect(getLanguage()).toBe('zh');
    expect(window.localStorage.getItem('lavray.lang')).toBe('zh');
  });
});
