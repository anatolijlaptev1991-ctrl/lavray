// SPDX-License-Identifier: GPL-3.0-only

// useTrayBridge.test.tsx — T-45: UI присылает оболочке состояние и строки
// меню трея из словарей, а выбор «Подключить»/«Отключить» доходит до UI.
// Оболочка (Tauri) заменена моками invoke/listen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CoreState } from '../gen/lavray_pb';
import { setLanguage } from '../lib/i18n';
import type { TrayAction } from '../lib/tray';
import { useTrayBridge } from './useTrayBridge';

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
  handlers: [] as ((event: { payload: unknown }) => void)[],
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (_name: string, handler: (event: { payload: unknown }) => void): Promise<() => void> => {
    shell.handlers.push(handler);
    return Promise.resolve(() => undefined);
  },
}));

function Probe(props: { state: CoreState; onAction: (a: TrayAction) => void }): JSX.Element | null {
  useTrayBridge({ state: props.state, activeProfileName: 'Frankfurt 01' }, props.onAction);
  return null;
}

const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('useTrayBridge', () => {
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    shell.invoke.mockReset().mockResolvedValue(null);
    shell.handlers.length = 0;
    setLanguage('de');
    root = createRoot(document.body.appendChild(document.createElement('div')));
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    setLanguage('en');
  });

  it('sends the state and the menu strings from the dictionary, again on a language switch', async () => {
    const onAction = vi.fn<(action: TrayAction) => void>();
    act(() => {
      root.render(<Probe state={CoreState.CONNECTED} onAction={onAction} />);
    });
    await flush();
    expect(shell.invoke).toHaveBeenCalledWith('tray_update', {
      update: {
        state: 'on',
        labels: {
          status: 'LAVRay — Verbunden',
          server: 'Server: Frankfurt 01',
          connect: 'Verbinden',
          disconnect: 'Trennen',
          show: 'LAVRay öffnen',
          quit: 'Beenden',
        },
      },
    });

    act(() => {
      setLanguage('ru');
    });
    await flush();
    expect(shell.invoke).toHaveBeenCalledTimes(2);
    const last = shell.invoke.mock.calls.at(-1)?.[1] as { update: { labels: object } };
    expect(last.update.labels).toMatchObject({
      status: 'LAVRay — Подключено',
      server: 'Сервер: Frankfurt 01',
      show: 'Открыть LAVRay',
      quit: 'Выход',
    });
  });

  it('delivers the tray menu choice to the UI and ignores unknown payloads', async () => {
    const onAction = vi.fn<(action: TrayAction) => void>();
    act(() => {
      root.render(<Probe state={CoreState.IDLE} onAction={onAction} />);
    });
    await flush();
    act(() => {
      for (const payload of ['connect', 'disconnect', 'rm -rf']) shell.handlers[0]?.({ payload });
    });
    expect(onAction.mock.calls).toEqual([['connect'], ['disconnect']]);
  });
});
