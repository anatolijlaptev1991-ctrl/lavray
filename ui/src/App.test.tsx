import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';

/** jsdom lacks matchMedia — install a minimal stub. */
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

/** React 18 act() environment flag. */
function setActEnvironment(on: boolean): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = on;
}

describe('App scaffold smoke render', () => {
  let root: Root | null = null;
  let host: HTMLDivElement;

  beforeEach(() => {
    setActEnvironment(true);
    stubMatchMedia();
    // App derives the initial language from the environment (DS §9).
    Object.defineProperty(navigator, 'languages', { value: ['ru-RU'], configurable: true });
    window.localStorage.clear();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-accent');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    vi.restoreAllMocks();
    setActEnvironment(false);
  });

  function renderApp(): void {
    act(() => {
      root?.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });
  }

  it('renders the five sections and the first screen', () => {
    renderApp();

    const buttons = Array.from(document.querySelectorAll<HTMLElement>('.sb-item'));
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Подключение',
      'Серверы',
      'Правила',
      'Диагностика',
      'Настройки',
    ]);
    // First screen — реальный экран «Подключение» (h2 + live-регион статуса).
    expect(document.querySelector('.conn h2')?.textContent).toBe('Подключение');
    expect(document.querySelector('#connState')).not.toBeNull();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.accent).toBe('amber');
  });

  it('switches sections via Ctrl+1..5', () => {
    renderApp();

    const press = (key: string): void => {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true }));
      });
    };

    press('3'); // Правила
    const items = Array.from(document.querySelectorAll<HTMLElement>('.sb-item'));
    expect(items[2]?.classList.contains('on')).toBe(true);

    press('5'); // Настройки → tabs: Параметры/Обновления
    expect(Array.from(document.querySelectorAll('[role="tab"]')).map((x) => x.textContent)).toEqual([
      'Параметры',
      'Обновления',
    ]);
  });

  it('shows a toast with an interpolated name (серверы, демо-тост)', () => {
    renderApp();
    // «Подключение» и «Серверы» — боевые (RPC); демо-тост живёт на
    // заглушке «Настройки» — переключаемся туда (Ctrl+5).
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true }));
    });
    const connect = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes('Подключиться'),
    );
    expect(connect).toBeDefined();
    act(() => {
      connect?.click();
    });

    const toast = document.querySelector<HTMLElement>('.toast');
    expect(toast?.textContent).toContain('Подключено · example.lavray.net');
    expect(toast?.getAttribute('role')).toBe('status');
  });
});
