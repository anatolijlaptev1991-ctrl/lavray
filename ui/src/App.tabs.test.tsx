// T-38 (C1-04, C2-03): вкладки раздела управляются с клавиатуры. Раньше у
// вкладок был roving tabindex (-1 у неактивных), но обработчика стрелок не
// было вовсе: «Подписки», «DNS», «Соединения», «Журнал», «Обновления» были
// недостижимы без мыши. Ожидание — прототип `initTabs`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';
import { t } from './lib/i18n';

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

describe('T-38: вкладки раздела с клавиатуры', () => {
  let root: Root | null = null;
  let host: HTMLDivElement;

  async function mountAt(hash: string): Promise<void> {
    window.location.hash = hash;
    await act(async () => {
      root?.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
      await sleep(60);
    });
  }

  function tabs(): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('#ghTabs [role="tab"]'));
  }

  function selected(): (string | null)[] {
    return tabs().map((b) => b.getAttribute('aria-selected'));
  }

  async function press(el: Element | undefined, key: string): Promise<void> {
    await act(async () => {
      el?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await sleep(20);
    });
  }

  beforeEach(() => {
    setActEnvironment(true);
    stubMatchMedia();
    Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
    window.localStorage.clear();
    window.history.replaceState({}, '', '/?onboarded=1&lang=en');
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

  it('→ на активной вкладке выбирает следующую и переносит на неё фокус', async () => {
    await mountAt('#screen=servers');
    expect(tabs().length).toBe(2);
    expect(tabs()[1]?.tabIndex, 'неактивная вкладка вне Tab-порядка').toBe(-1);
    tabs()[0]?.focus();
    await press(tabs()[0], 'ArrowRight');
    expect(selected()).toEqual(['false', 'true']);
    expect(document.activeElement).toBe(tabs()[1]);
    expect(tabs()[1]?.tabIndex).toBe(0);
    expect(document.querySelector('#ghSub')?.textContent, 'подзаголовок новой вкладки').toBe(t('scr.subs.sub', 'en'));
  });

  it('← с первой вкладки уходит на последнюю, Home и End — на первую и последнюю', async () => {
    await mountAt('#screen=diag');
    expect(tabs().length).toBe(3);
    tabs()[0]?.focus();
    await press(tabs()[0], 'ArrowLeft');
    expect(selected()).toEqual(['false', 'false', 'true']);
    expect(document.activeElement).toBe(tabs()[2]);
    await press(tabs()[2], 'Home');
    expect(selected()).toEqual(['true', 'false', 'false']);
    expect(document.activeElement).toBe(tabs()[0]);
    await press(tabs()[0], 'End');
    expect(selected()).toEqual(['false', 'false', 'true']);
    expect(document.activeElement).toBe(tabs()[2]);
  });

  it('прочие клавиши вкладку не меняют', async () => {
    await mountAt('#screen=servers');
    tabs()[0]?.focus();
    await press(tabs()[0], 'ArrowDown');
    await press(tabs()[0], 'a');
    expect(selected()).toEqual(['true', 'false']);
  });

  it('aria-controls каждой вкладки указывает на панель, подписанную выбранной вкладкой', async () => {
    await mountAt('#screen=settings');
    for (const tab of tabs()) {
      const controls = tab.getAttribute('aria-controls');
      expect(controls, `aria-controls у вкладки «${tab.textContent ?? ''}»`).not.toBeNull();
      const panel = document.getElementById(controls ?? '');
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe(tabs().find((b) => b.getAttribute('aria-selected') === 'true')?.id);
    }
  });

  it('у раздела с одной вкладкой нет ни tablist, ни tabpanel', async () => {
    await mountAt('#screen=connection');
    expect(document.querySelector('#ghTabs')).toBeNull();
    expect(document.querySelector('[role="tabpanel"]')).toBeNull();
  });
});
