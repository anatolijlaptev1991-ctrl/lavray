// dialog-focus.test.tsx — T-05 (F-046): диалоги ставят фокус ОДИН раз при
// открытии. Родители передают onClose новой стрелкой на каждый рендер, а
// AppInner перерисовывается раз в секунду; раньше эффект зависел от onClose
// и каждый раз возвращал фокус в корень диалога / первое поле.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act, createRef } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import App from '../App';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients } from '../lib/core';
import { DialogShell } from './dialogs';
import { ImportDialog } from './ImportDialog';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function setActEnvironment(on: boolean): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = on;
}

/** React-совместимая установка значения в controlled input. */
function setNativeValue(el: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressKey(key: string): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('T-05: фокус в диалогах ставится один раз', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setActEnvironment(true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
    setActEnvironment(false);
    vi.restoreAllMocks();
  });

  function render(el: ReactElement): void {
    act(() => {
      root.render(el);
    });
  }

  it('DialogShell: при открытии фокус в диалоге, после ререндера родителя фокус не двигается', () => {
    // onClose — новая стрелка при каждом вызове shell(), как у родителей
    const shell = (): ReactElement => (
      <DialogShell titleId="t5Title" title="T-05" onClose={() => undefined}>
        <input id="t5a" aria-label="a" />
        <input id="t5b" aria-label="b" />
      </DialogShell>
    );
    render(shell());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(document.activeElement).toBe(dialog);

    const field = document.querySelector<HTMLInputElement>('#t5b');
    act(() => {
      field?.focus();
    });
    expect(document.activeElement).toBe(field);

    // три «секундных» ререндера родителя с новым onClose
    for (let i = 0; i < 3; i += 1) {
      render(shell());
      expect(document.activeElement, `фокус после ререндера №${String(i + 1)}`).toBe(field);
    }
  });

  it('DialogShell: Esc вызывает ПОСЛЕДНИЙ onClose, а не тот, что был при открытии', () => {
    const first = vi.fn();
    const second = vi.fn();
    const shell = (onClose: () => void): ReactElement => (
      <DialogShell titleId="t5Title" title="T-05" onClose={onClose}>
        <input aria-label="a" />
      </DialogShell>
    );
    render(shell(first));
    render(shell(second));
    pressKey('Escape');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('DialogShell: autofocusRef получает фокус при открытии и больше его не забирает', () => {
    const target = createRef<HTMLInputElement>();
    const shell = (): ReactElement => (
      <DialogShell titleId="t5Title" title="T-05" onClose={() => undefined} autofocusRef={target}>
        <input id="t5a" aria-label="a" />
        <input id="t5b" aria-label="b" ref={target} />
      </DialogShell>
    );
    render(shell());
    expect(document.activeElement?.id).toBe('t5b');

    const other = document.querySelector<HTMLInputElement>('#t5a');
    act(() => {
      other?.focus();
    });
    render(shell());
    expect(document.activeElement, 'фокус остался там, куда его поставил пользователь').toBe(other);
  });

  it('ImportDialog: фокус в «Имя подписки» не возвращается в поле ссылки после ререндера', () => {
    const clients = createCoreClients('http://127.0.0.1:1');
    const dialog = (): ReactElement => (
      <CoreContext.Provider value={clients}>
        <ImportDialog groupId={1n} onClose={() => undefined} onImported={() => undefined} />
      </CoreContext.Provider>
    );
    render(dialog());
    expect(document.activeElement?.id).toBe('impLink');

    act(() => {
      const link = document.querySelector<HTMLInputElement>('#impLink');
      if (link) setNativeValue(link, 'https://provider.example/sub?token=abc');
    });
    const name = document.querySelector<HTMLInputElement>('#impName');
    expect(name, 'для https-ссылки появляется поле имени подписки').not.toBeNull();
    act(() => {
      name?.focus();
    });
    expect(document.activeElement?.id).toBe('impName');

    render(dialog());
    render(dialog());
    expect(document.activeElement?.id).toBe('impName');
  });
});

// Сценарии аудита C1 целиком: настоящий App, опрос статуса раз в секунду
// (ядро недоступно: каждый тик getStatus падает и кладёт в state новый объект).
describe('T-05: App целиком, опрос статуса не крадёт фокус', () => {
  let host: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    setActEnvironment(true);
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query === '(prefers-color-scheme: dark)',
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
    window.localStorage.clear();
    window.history.replaceState({}, '', '/?onboarded=1&lang=en');
    window.location.hash = '#screen=servers';
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
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    setActEnvironment(false);
  });

  async function mountApp(): Promise<void> {
    await act(async () => {
      root?.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
      await sleep(50);
    });
  }

  it('импорт: фокус остаётся в «Имя подписки» после тика опроса статуса', async () => {
    await mountApp();
    const importBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.srv-actions button')).find(
      (b) => /import/i.test(b.textContent ?? ''),
    );
    expect(importBtn, 'кнопка «Импорт» на экране «Серверы»').toBeDefined();
    await act(async () => {
      importBtn?.click();
      await sleep(20);
    });
    await act(async () => {
      const link = document.querySelector<HTMLInputElement>('#impLink');
      if (link) setNativeValue(link, 'https://provider.example/sub?token=abc');
      await sleep(20);
    });
    const name = document.querySelector<HTMLInputElement>('#impName');
    expect(name).not.toBeNull();
    await act(async () => {
      name?.focus();
      await sleep(5);
    });
    expect(document.activeElement?.id).toBe('impName');
    await act(async () => {
      await sleep(1300); // минимум один тик опроса (1000 мс)
    });
    expect(document.activeElement?.id, 'фокус должен остаться в поле имени').toBe('impName');
  }, 10_000);

  it('«Группы»: фокус остаётся в поле «Название группы» после тика опроса статуса', async () => {
    await mountApp();
    const groups = Array.from(document.querySelectorAll<HTMLButtonElement>('.prof-toolbar button')).find(
      (b) => /groups/i.test(b.textContent ?? ''),
    );
    expect(groups, 'кнопка «Группы»').toBeDefined();
    await act(async () => {
      groups?.click();
      await sleep(20);
    });
    const input = document.querySelector<HTMLInputElement>('.grp-dlg-new input');
    expect(input).not.toBeNull();
    await act(async () => {
      input?.focus();
      await sleep(5);
    });
    expect(document.activeElement).toBe(input);
    await act(async () => {
      await sleep(1300);
    });
    expect(document.activeElement, 'фокус должен остаться в поле ввода').toBe(input);
  }, 10_000);
});
