// SPDX-License-Identifier: GPL-3.0-only

// useSystemProxyFollow.test.tsx — MCP: подключение сделал другой клиент, а окно
// ставит и снимает системный прокси ровно один раз, как кнопка. Собственное
// подключение окна второго вызова не порождает. Оболочка (Tauri) — мок invoke.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import {
  ConnectMode,
  CoreState,
  CoreStatusSchema,
  InboundInfoSchema,
  type CoreStatus,
} from '../gen/lavray_pb';
import { applySystemProxy, connectWith, disconnectAll, saveModes } from '../lib/connection';
import type { CoreClients } from '../lib/core';
import { useSystemProxyFollow } from './useSystemProxyFollow';

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));

function status(state: CoreState, mode = ConnectMode.SYSTEM_PROXY, port = 2080): CoreStatus {
  return create(CoreStatusSchema, { state, mode, inbound: create(InboundInfoSchema, { listen: '127.0.0.1', port }) });
}

function Probe(props: { status: CoreStatus }): JSX.Element | null {
  useSystemProxyFollow(props.status);
  return null;
}

const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** Вызовы set_system_proxy в порядке поступления. */
const proxyCalls = (): unknown[] =>
  shell.invoke.mock.calls.filter(([cmd]) => cmd === 'set_system_proxy').map(([, args]) => args);

describe('useSystemProxyFollow', () => {
  let root: Root;
  const render = async (s: CoreStatus): Promise<void> => {
    act(() => {
      root.render(<Probe status={s} />);
    });
    await flush();
  };

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    window.localStorage.clear();
    shell.invoke.mockReset().mockResolvedValue('');
    await applySystemProxy(false, 0); // флаг «прокси применён» — чистый
    shell.invoke.mockClear();
    root = createRoot(document.body.appendChild(document.createElement('div')));
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    window.localStorage.clear();
  });

  it('подключение извне применяет прокси ровно один раз, отключение снимает ровно один раз', async () => {
    await render(status(CoreState.IDLE));
    expect(proxyCalls()).toEqual([]);

    await render(status(CoreState.CONNECTED, ConnectMode.SYSTEM_PROXY, 2081));
    expect(proxyCalls()).toEqual([{ enabled: true, port: 2081 }]);

    // опрос статуса раз в секунду присылает новые объекты — прокси не повторяется
    await render(status(CoreState.CONNECTED, ConnectMode.SYSTEM_PROXY, 2081));
    await render(status(CoreState.CONNECTED, ConnectMode.SYSTEM_PROXY, 2081));
    expect(proxyCalls()).toHaveLength(1);

    await render(status(CoreState.DISCONNECTING, ConnectMode.SYSTEM_PROXY, 2081));
    expect(proxyCalls()).toHaveLength(1);
    await render(status(CoreState.IDLE));
    expect(proxyCalls()).toEqual([
      { enabled: true, port: 2081 },
      { enabled: false, port: 1 },
    ]);
    await render(status(CoreState.IDLE));
    expect(proxyCalls()).toHaveLength(2);
  });

  it('порт берётся из статуса ядра, по умолчанию 2080', async () => {
    await render(status(CoreState.IDLE));
    await render(create(CoreStatusSchema, { state: CoreState.CONNECTED, mode: ConnectMode.SYSTEM_PROXY }));
    expect(proxyCalls()).toEqual([{ enabled: true, port: 2080 }]);
  });

  it('при выключенном «Системном прокси» окно прокси не ставит', async () => {
    saveModes(window.localStorage, { sysProxy: false, tunMode: false });
    await render(status(CoreState.IDLE));
    await render(status(CoreState.CONNECTED));
    expect(proxyCalls()).toEqual([]);
  });

  it('первый кадр с уже работающим ядром ничего не меняет', async () => {
    await render(status(CoreState.CONNECTED));
    await render(status(CoreState.CONNECTED));
    expect(proxyCalls()).toEqual([]);
  });

  it('отказ оболочки не повторяется каждую секунду', async () => {
    shell.invoke.mockRejectedValue(new Error('прокси недоступен'));
    await render(status(CoreState.IDLE));
    await render(status(CoreState.CONNECTED));
    await render(status(CoreState.CONNECTED));
    await render(status(CoreState.CONNECTED));
    expect(proxyCalls()).toHaveLength(1);
  });

  it('собственное подключение окна: прокси ставит само окно, дубля нет', async () => {
    const clients = { core: { connect: vi.fn(), disconnect: vi.fn() } } as unknown as CoreClients;
    // ядро отвечает на connect, но пока идёт собственный вызов, окно уже видит CONNECTED
    let finishConnect: () => void = () => undefined;
    (clients.core.connect as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishConnect = resolve;
        }),
    );

    await render(status(CoreState.IDLE));
    const own = connectWith({
      core: clients,
      profileId: 5n,
      modes: { sysProxy: true, tunMode: false },
      port: 2080,
    });
    await render(status(CoreState.CONNECTED)); // опрос успел увидеть подключение
    expect(proxyCalls(), 'пока идёт свой вызов, окно не вмешивается').toEqual([]);
    finishConnect();
    await act(async () => {
      await own;
    });
    await render(status(CoreState.CONNECTED));
    await render(status(CoreState.CONNECTED));
    expect(proxyCalls()).toEqual([{ enabled: true, port: 2080 }]);
  });

  it('собственное отключение окна: прокси снимается один раз', async () => {
    const clients = { core: { connect: vi.fn(), disconnect: vi.fn().mockResolvedValue({}) } } as unknown as CoreClients;
    await render(status(CoreState.IDLE));
    await render(status(CoreState.CONNECTED));
    expect(proxyCalls()).toEqual([{ enabled: true, port: 2080 }]);

    const own = disconnectAll(clients);
    await render(status(CoreState.IDLE));
    await act(async () => {
      await own;
    });
    await render(status(CoreState.IDLE));
    expect(proxyCalls()).toEqual([
      { enabled: true, port: 2080 },
      { enabled: false, port: 1 },
    ]);
  });

  it('вне оболочки (веб-панель) прокси ОС не трогается', async () => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    await render(status(CoreState.IDLE));
    await render(status(CoreState.CONNECTED));
    expect(shell.invoke).not.toHaveBeenCalled();
  });

  // Автоподключение ядра (--connect-last): окно не нажимало "Подключить", но
  // системный прокси должен появиться, а при сбое не остаться на мёртвом порту.
  it('автоподключение ядра в режиме системного прокси: прокси ставится, при падении снимается', async () => {
    await render(status(CoreState.IDLE)); // заглушка до первого ответа ядра
    await render(status(CoreState.CONNECTING));
    expect(proxyCalls()).toEqual([]);
    await render(status(CoreState.CONNECTED));
    expect(proxyCalls()).toEqual([{ enabled: true, port: 2080 }]);
    await render(status(CoreState.ERROR));
    expect(proxyCalls()).toEqual([
      { enabled: true, port: 2080 },
      { enabled: false, port: 1 },
    ]);
  });

  it('сбой автоподключения: прокси не включается ни разу', async () => {
    await render(status(CoreState.IDLE));
    await render(status(CoreState.CONNECTING));
    await render(status(CoreState.ERROR));
    await render(status(CoreState.ERROR));
    expect(proxyCalls()).toEqual([]);
  });
});
