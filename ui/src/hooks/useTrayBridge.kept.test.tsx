// SPDX-License-Identifier: GPL-3.0-only

// useTrayBridge.kept.test.tsx — kill switch: пока системный прокси оставлен, трей
// показывает ошибку при ЛЮБОМ следующем обновлении (смена состояния, сервера, языка),
// а не один раз по событию. Оболочка (Tauri) заменена мок-функциями.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CoreState } from '../gen/lavray_pb';
import { setLanguage, t } from '../lib/i18n';
import { clearProxyKept, markProxyKept } from '../lib/killSwitch';
import { useTrayBridge } from './useTrayBridge';

const shell = vi.hoisted(() => ({ invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: (): Promise<() => void> => Promise.resolve(() => undefined) }));

function Probe({ state, name }: { state: CoreState; name: string }): JSX.Element | null {
  useTrayBridge({ state, activeProfileName: name }, () => undefined);
  return null;
}

const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

interface Update {
  state: string;
  labels: { status: string };
}
const lastUpdate = (): Update =>
  (shell.invoke.mock.calls.filter(([c]) => c === 'tray_update').at(-1)?.[1] as { update: Update }).update;

describe('useTrayBridge: прокси оставлен (kill switch)', () => {
  let root: Root;
  const render = async (state: CoreState, name = 'Frankfurt 01'): Promise<void> => {
    act(() => {
      root.render(<Probe state={state} name={name} />);
    });
    await flush();
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    shell.invoke.mockReset().mockResolvedValue(null);
    setLanguage('en');
    clearProxyKept();
    root = createRoot(document.body.appendChild(document.createElement('div')));
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    clearProxyKept();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('флаг поднят — состояние «ошибка» и подпись про сохранённый прокси', async () => {
    await render(CoreState.CONNECTED);
    expect(lastUpdate().state).toBe('on');
    await act(async () => {
      markProxyKept();
      await Promise.resolve();
    });
    await flush();
    expect(lastUpdate().state).toBe('error');
    expect(lastUpdate().labels.status).toBe(`LAVRay — ${t('kill.tray')}`);
  });

  it('следующая смена состояния, сервера или языка ошибку не затирает', async () => {
    await render(CoreState.CONNECTED);
    act(() => {
      markProxyKept();
    });
    await flush();

    await render(CoreState.IDLE); // ядро перезапущено, состояние сменилось
    expect(lastUpdate().state).toBe('error');
    await render(CoreState.IDLE, 'Amsterdam 02'); // сменился сервер
    expect(lastUpdate().state).toBe('error');
    act(() => {
      setLanguage('de');
    });
    await flush();
    expect(lastUpdate().state).toBe('error');
    expect(lastUpdate().labels.status).toBe(`LAVRay — ${t('kill.tray', 'de')}`);
  });

  it('флаг снят (прокси отпущен или подключились снова) — трей возвращается к состоянию ядра', async () => {
    await render(CoreState.CONNECTED);
    act(() => {
      markProxyKept();
    });
    await flush();
    expect(lastUpdate().state).toBe('error');
    act(() => {
      clearProxyKept();
    });
    await flush();
    expect(lastUpdate().state).toBe('on');
    expect(lastUpdate().labels.status).toBe(`LAVRay — ${t('conn.state.on')}`);
  });
});
