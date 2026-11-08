// SPDX-License-Identifier: GPL-3.0-only

// usePendingConnect.test.tsx — после перезапуска от администратора окно один
// раз доводит подключение до конца; без перезапуска, при просрочке или при
// уже идущем соединении не трогает ядро и всё равно снимает намерение.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import { CoreState, CoreStatusSchema, type CoreStatus } from '../gen/lavray_pb';
import { PENDING_CONNECT_KEY, savePendingConnect } from '../lib/pendingConnect';
import { saveModes } from '../lib/connection';
import { usePendingConnect } from './usePendingConnect';

const h = vi.hoisted(() => ({
  connect: vi.fn<(req: unknown) => Promise<unknown>>(),
  relaunched: { value: true },
  elevated: { value: true },
  notify: vi.fn<(...a: unknown[]) => Promise<boolean>>(),
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('./useCore', () => ({ useCore: (): unknown => ({ core: { connect: h.connect } }) }));
vi.mock('../lib/launch', () => ({ wasRelaunchedAtStart: (): boolean => h.relaunched.value }));
vi.mock('../lib/elevation', () => ({
  tunNeedsElevation: (): Promise<boolean> => Promise.resolve(!h.elevated.value),
}));
vi.mock('../lib/notify', () => ({ showNotification: h.notify }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }));

const real = (state: CoreState): CoreStatus => create(CoreStatusSchema, { state, coreVersion: '1.14.1-lav.1' });
const placeholder = (): CoreStatus => create(CoreStatusSchema, { state: CoreState.IDLE });

function Probe(props: { status: CoreStatus }): JSX.Element | null {
  usePendingConnect(props.status);
  return null;
}

const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('usePendingConnect', () => {
  let root: Root;
  const render = async (s: CoreStatus): Promise<void> => {
    act(() => {
      root.render(<Probe status={s} />);
    });
    await flush();
  };
  const save = (age = 1000): void => {
    savePendingConnect(window.localStorage, { profileId: 7n, mode: 'tun', ts: Date.now() - age });
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    window.localStorage.clear();
    saveModes(window.localStorage, { sysProxy: false, tunMode: true });
    h.connect.mockReset().mockResolvedValue({});
    h.notify.mockReset().mockResolvedValue(true);
    h.invoke.mockReset().mockResolvedValue('');
    h.relaunched.value = true;
    h.elevated.value = true;
    root = createRoot(document.body.appendChild(document.createElement('div')));
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    window.localStorage.clear();
  });

  it('подключает сохранённый сервер в TUN один раз и снимает намерение', async () => {
    save();
    await render(placeholder()); // заглушка до ответа ядра ничего не запускает
    expect(h.connect).not.toHaveBeenCalled();
    await render(real(CoreState.IDLE));
    await render(real(CoreState.IDLE));
    await render(real(CoreState.CONNECTING));
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(h.connect.mock.calls[0]?.[0]).toMatchObject({ profileId: 7n });
    expect(window.localStorage.getItem(PENDING_CONNECT_KEY)).toBeNull();
  });

  it('без --elevated-relaunch не подключает, но намерение удаляет', async () => {
    h.relaunched.value = false;
    save();
    await render(real(CoreState.IDLE));
    expect(h.connect).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(PENDING_CONNECT_KEY)).toBeNull();
  });

  it('просроченное намерение (старше двух минут) не исполняется', async () => {
    save(3 * 60 * 1000);
    await render(real(CoreState.IDLE));
    expect(h.connect).not.toHaveBeenCalled();
  });

  it('если ядро уже подключено, оно не трогается', async () => {
    save();
    await render(real(CoreState.CONNECTED));
    expect(h.connect).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(PENDING_CONNECT_KEY)).toBeNull();
  });

  it('ошибка подключения — уведомление, без повторов', async () => {
    window.localStorage.setItem('lavray.notify', '1');
    h.connect.mockRejectedValue(new Error('boom'));
    save();
    await render(real(CoreState.IDLE));
    await render(real(CoreState.IDLE));
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it('TUN без прав после перезапуска: ядро не трогаем и новый UAC не просим', async () => {
    h.elevated.value = false;
    save();
    await render(real(CoreState.IDLE));
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.invoke.mock.calls.filter(([cmd]) => cmd === 'relaunch_elevated')).toEqual([]);
  });
});
