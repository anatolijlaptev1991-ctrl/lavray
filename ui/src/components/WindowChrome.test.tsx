// WindowChrome.test.tsx — T-62: подписка на события окна одна на все кнопки и
// не утекает, если компонент размонтирован до завершения подписки.
// Модули @tauri-apps/api не мокаются (Vitest при двух параллельных import()
// одного мока отдаёт второму настоящий модуль): подменяется только мост
// window.__TAURI_INTERNALS__, через который идут все вызовы библиотеки.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WindowChrome } from './WindowChrome';

interface Bridge {
  /** Все вызовы invoke: команда оболочки или plugin:event|listen / unlisten. */
  calls: string[];
  /** Завершает зависший plugin:event|listen (если мост создан с hold=true). */
  release: ((eventId: number) => void) | null;
}

let bridge: Bridge = { calls: [], release: null };
let root: Root | null = null;
let host: HTMLDivElement | null = null;

const count = (cmd: string): number => bridge.calls.filter((c) => c === cmd).length;

function installBridge(hold: boolean): void {
  bridge = { calls: [], release: null };
  const internals = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (): number => 1,
    invoke: (cmd: string): Promise<unknown> => {
      bridge.calls.push(cmd);
      if (cmd === 'plugin:event|listen' && hold) {
        return new Promise<number>((resolve) => {
          bridge.release = resolve;
        });
      }
      if (cmd === 'plugin:event|listen') return Promise.resolve(7);
      return Promise.resolve(cmd === 'window_is_maximized' ? false : null);
    },
  };
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI_INTERNALS__ = internals;
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (): void => undefined };
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  });
}

/** Ждём, пока число IPC-вызовов перестанет расти (динамические import() завершаются в разный момент). */
async function settle(): Promise<void> {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 60 && stable < 4; i += 1) {
    await tick(25);
    stable = bridge.calls.length === last ? stable + 1 : 0;
    last = bridge.calls.length;
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
  const w = window as unknown as Record<string, unknown>;
  delete w.__TAURI_INTERNALS__;
  delete w.__TAURI_EVENT_PLUGIN_INTERNALS__;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

/** Оба слота шапки, как в App.tsx: «светофор» (start) и кнопки Windows/Linux (end). */
function bothSlots(os: string): ReturnType<typeof createElement> {
  return createElement(
    Fragment,
    null,
    createElement(WindowChrome, { os, placement: 'start' }),
    createElement(WindowChrome, { os, placement: 'end' }),
  );
}

describe('WindowChrome: события окна', () => {
  it('Windows: одна подписка на изменение размера и один опрос состояния, а не по одному на слот', async () => {
    installBridge(false);
    act(() => {
      root?.render(bothSlots('windows'));
    });
    await settle();
    expect(host?.querySelectorAll('.caps-win .cap-btn')).toHaveLength(3);
    expect(count('plugin:event|listen')).toBe(1);
    expect(count('window_is_maximized')).toBe(1);
  });

  it('macOS: так же одна подписка (рисуется только слот start)', async () => {
    installBridge(false);
    act(() => {
      root?.render(bothSlots('macos'));
    });
    await settle();
    expect(host?.querySelectorAll('.tl-mac .tl')).toHaveLength(3);
    expect(count('plugin:event|listen')).toBe(1);
  });

  it('неизвестная ОС (веб): кнопок нет и подписки нет', async () => {
    installBridge(false);
    act(() => {
      root?.render(bothSlots('web'));
    });
    await settle();
    expect(host?.querySelector('button')).toBeNull();
    expect(count('plugin:event|listen')).toBe(0);
    expect(count('window_is_maximized')).toBe(0);
  });

  it('размонтирование до завершения подписки: слушатель снимается, а не утекает', async () => {
    installBridge(true);
    act(() => {
      root?.render(bothSlots('windows'));
    });
    await settle();
    expect(count('plugin:event|listen')).toBeGreaterThan(0);
    expect(bridge.release).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    root = createRoot(host!); // чтобы afterEach мог размонтировать
    await act(async () => {
      bridge.release?.(7); // подписка завершилась уже после размонтирования
      await Promise.resolve();
    });
    await settle();
    expect(count('plugin:event|unlisten')).toBe(1);
  });

  it('размонтирование после подписки: слушатель снимается ровно один раз', async () => {
    installBridge(false);
    act(() => {
      root?.render(bothSlots('windows'));
    });
    await settle();
    expect(count('plugin:event|listen')).toBe(1);
    act(() => {
      root?.unmount();
    });
    root = createRoot(host!);
    await settle();
    expect(count('plugin:event|unlisten')).toBe(1);
  });
});
