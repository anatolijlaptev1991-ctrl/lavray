// SPDX-License-Identifier: GPL-3.0-only

// T-37 (C1-03): тема, выбранная в «Настройках», не должна откатываться при
// смене темы ОС. Раньше App.tsx хранил начальные настройки в useState без
// сеттера, а слушатель темы ОС применял именно их и ещё записывал в
// localStorage: выбор пользователя затирался навсегда.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { warmViews } from './test-harness';
import App from './App';

type Listener = (e: { matches: boolean }) => void;

beforeAll(warmViews, 60_000);

describe('T-37: выбор темы переживает смену темы ОС', () => {
  const darkListeners = new Set<Listener>();
  let osDark = true;
  let root: Root | null = null;
  let host: HTMLDivElement;

  /** Имитация смены темы ОС: меняется matchMedia и вызываются слушатели `change`. */
  async function switchOsTheme(dark: boolean): Promise<void> {
    osDark = dark;
    await act(async () => {
      for (const l of [...darkListeners]) l({ matches: dark });
      await sleep(20);
    });
  }

  function stubMatchMedia(): void {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      const isDark = query === '(prefers-color-scheme: dark)';
      return {
        get matches(): boolean {
          return isDark && osDark;
        },
        media: query,
        addEventListener: (_: string, l: Listener) => {
          if (isDark) darkListeners.add(l);
        },
        removeEventListener: (_: string, l: Listener) => {
          if (isDark) darkListeners.delete(l);
        },
      } as unknown as MediaQueryList;
    });
  }

  function setActEnvironment(on: boolean): void {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = on;
  }

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
    darkListeners.clear();
    osDark = true;
    stubMatchMedia();
    Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
    window.localStorage.clear();
    window.history.replaceState({}, '', '/?onboarded=1&lang=en');
    window.location.hash = '#screen=settings';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-accent');
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

  it('пользователь выбрал Light; ОС переключилась на тёмную → тема остаётся Light, выбор сохранён', async () => {
    await mountApp();
    const light = Array.from(document.querySelectorAll<HTMLButtonElement>('.seg button')).find(
      (b) => (b.textContent ?? '').trim() === 'Light',
    );
    expect(light, 'кнопка «Light» в Настройки → Внешний вид').toBeDefined();
    await act(async () => {
      light?.click();
      await sleep(20);
    });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('lavray.theme')).toBe('light');

    await switchOsTheme(true);
    expect(document.documentElement.dataset.theme, 'data-theme после change ОС').toBe('light');
    expect(window.localStorage.getItem('lavray.theme'), 'сохранённый выбор').toBe('light');
  });

  it('выбрано «Как в системе» → тема следует за ОС, но в хранилище остаётся «system»', async () => {
    window.localStorage.setItem('lavray.theme', 'system');
    await mountApp();
    expect(document.documentElement.dataset.theme).toBe('dark');

    await switchOsTheme(false);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.accent, 'акцент «Авто» следует теме: светлая → sage').toBe('sage');
    expect(window.localStorage.getItem('lavray.theme')).toBe('system');

    await switchOsTheme(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('lavray.theme')).toBe('system');
  });

  it('фиксированная тёмная тема не меняется от темы ОС', async () => {
    window.localStorage.setItem('lavray.theme', 'dark');
    osDark = false;
    await mountApp();
    expect(document.documentElement.dataset.theme).toBe('dark');
    await switchOsTheme(true);
    await switchOsTheme(false);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('lavray.theme')).toBe('dark');
  });
});
