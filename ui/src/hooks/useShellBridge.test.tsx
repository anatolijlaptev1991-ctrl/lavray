// SPDX-License-Identifier: GPL-3.0-only

// useShellBridge.test.tsx — T-82: уведомления только при скрытом окне и
// включённой настройке; глобальное сочетание переключает подключение, но не во
// время перехода; отписка при размонтировании.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { JSX } from 'react';
import { CoreState } from '../gen/lavray_pb';
import { HOTKEY_EVENT } from '../lib/globalHotkey';
import { setLanguage } from '../lib/i18n';
import { SHELL_PREF_KEYS } from '../lib/shellPrefs';
import { flush, mountBare, unmountAll } from '../test-utils/coreStub';
import { useGlobalHotkey, useNotifications } from './useShellBridge';

vi.mock('@tauri-apps/api/core', async () => (await import('../test-utils/tauriStub')).tauriCoreModule);
vi.mock('@tauri-apps/api/event', async () => (await import('../test-utils/tauriStub')).tauriEventModule);
const { tauri, enableTauri, disableTauri } = await import('../test-utils/tauriStub');

function Notifications({ state }: { readonly state: CoreState }): JSX.Element | null {
  useNotifications(state);
  return null;
}

function Hotkey({ state, onToggle }: { readonly state: CoreState; readonly onToggle: () => void }): JSX.Element | null {
  useGlobalHotkey(state, onToggle);
  return null;
}

let focused = true;

beforeEach(() => {
  setLanguage('en');
  tauri.reset();
  tauri.onValue('notify_show', true);
  enableTauri();
  focused = true;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
  window.localStorage.clear();
  disableTauri();
});

async function drive(states: readonly CoreState[]): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  for (const state of states) {
    await act(async () => {
      root.render(createElement(Notifications, { state }));
      await Promise.resolve();
    });
  }
  await flush();
  act(() => {
    root.unmount();
  });
  container.remove();
}

describe('useNotifications (T-82)', () => {
  it('only_when_hidden', async () => {
    await drive([CoreState.CONNECTING, CoreState.CONNECTED]);
    expect(tauri.argsOf('notify_show')).toEqual([]);
    focused = false;
    await drive([CoreState.CONNECTING, CoreState.CONNECTED]);
    expect(tauri.argsOf('notify_show')).toEqual([
      { kind: 'connected', title: 'LAVRay', body: 'Connected: traffic goes through the VPN' },
    ]);
  });

  it('disabled_pref_no_calls', async () => {
    focused = false;
    window.localStorage.setItem(SHELL_PREF_KEYS.notify, '0');
    await drive([CoreState.CONNECTED, CoreState.ERROR, CoreState.IDLE]);
    expect(tauri.argsOf('notify_show')).toEqual([]);
  });

  it('error_and_disconnect_are_reported', async () => {
    focused = false;
    await drive([CoreState.CONNECTED, CoreState.ERROR]);
    await drive([CoreState.CONNECTED, CoreState.IDLE]);
    expect(tauri.argsOf('notify_show').map((a) => (a as { kind: string }).kind)).toEqual(['error', 'disconnected']);
  });

  it('first_render_is_silent', async () => {
    focused = false;
    await drive([CoreState.CONNECTED]);
    expect(tauri.argsOf('notify_show')).toEqual([]);
  });
});

describe('useGlobalHotkey (T-82)', () => {
  it('hotkey_toggles_connect', async () => {
    const onToggle = vi.fn();
    await mountBare(createElement(Hotkey, { state: CoreState.IDLE, onToggle }));
    await flush();
    tauri.emit(HOTKEY_EVENT);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('ignored_while_connecting', async () => {
    const onToggle = vi.fn();
    for (const state of [CoreState.CONNECTING, CoreState.DISCONNECTING, CoreState.RECONNECTING]) {
      await mountBare(createElement(Hotkey, { state, onToggle }));
      await flush();
      tauri.emit(HOTKEY_EVENT);
      unmountAll();
    }
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('unsubscribes_on_unmount', async () => {
    const onToggle = vi.fn();
    await mountBare(createElement(Hotkey, { state: CoreState.CONNECTED, onToggle }));
    await flush();
    expect(tauri.listenerCount(HOTKEY_EVENT)).toBe(1);
    unmountAll();
    expect(tauri.listenerCount(HOTKEY_EVENT)).toBe(0);
  });
});
