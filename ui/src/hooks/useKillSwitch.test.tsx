// SPDX-License-Identifier: GPL-3.0-only

// useKillSwitch.test.tsx — зеркало настройки для оболочки и реакция на `proxy-kept`:
// флаг, трей «ошибка», уведомление. Tauri подставной: ни оболочка, ни системный прокси не тронуты.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { CoreState } from '../gen/lavray_pb';
import { KILL_SWITCH_KEY, KILL_SWITCH_SETTING, clearProxyKept, isProxyKept } from '../lib/killSwitch';
import { setLanguage, t } from '../lib/i18n';
import { flush, mount, stubCore, unmountAll } from '../test-utils/coreStub';
import { useKillSwitch } from './useKillSwitch';
import type { SettingsMap } from './useSettingsSync';

const tauri = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: () => void): Promise<() => void> => {
    tauri.handlers.set(name, handler);
    return Promise.resolve(() => {
      tauri.handlers.delete(name);
    });
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

function Probe({ values, state }: { readonly values: SettingsMap; readonly state: CoreState }): null {
  useKillSwitch(values, state);
  return null;
}

beforeEach(() => {
  setLanguage('en');
  stubCore({});
  tauri.handlers.clear();
  tauri.invoke.mockReset();
  tauri.invoke.mockResolvedValue(true);
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  window.localStorage.clear();
});

afterEach(() => {
  unmountAll();
  clearProxyKept();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
});

const probe = (values: SettingsMap, state = CoreState.IDLE): ReturnType<typeof mount> =>
  mount(createElement(Probe, { values, state }));

describe('useKillSwitch: зеркало для оболочки', () => {
  it('настройка включена — в ui-state попадает "1", выключена — "0"', async () => {
    await probe({ [KILL_SWITCH_SETTING]: true });
    expect(window.localStorage.getItem(KILL_SWITCH_KEY)).toBe('1');
    unmountAll();
    await probe({ [KILL_SWITCH_SETTING]: false });
    expect(window.localStorage.getItem(KILL_SWITCH_KEY)).toBe('0');
  });

  it('настройки ещё не прочитаны (пустая карта) — зеркало не трогаем, значение прошлого сеанса цело', async () => {
    window.localStorage.setItem(KILL_SWITCH_KEY, '1');
    await probe({});
    expect(window.localStorage.getItem(KILL_SWITCH_KEY)).toBe('1');
  });
});

describe('useKillSwitch: событие оболочки proxy-kept', () => {
  it('ставит флаг, отправляет трею «ошибка» и показывает уведомление', async () => {
    await probe({ [KILL_SWITCH_SETTING]: true });
    const fire = tauri.handlers.get('proxy-kept');
    expect(fire).toBeTypeOf('function');
    await act(async () => {
      fire?.();
      await Promise.resolve();
    });
    await flush();
    expect(isProxyKept()).toBe(true);
    const tray = tauri.invoke.mock.calls.find(([cmd]) => cmd === 'tray_update');
    const update = (tray?.[1] as { update: { state: string; labels: { status: string } } }).update;
    expect(update.state).toBe('error');
    expect(update.labels.status).toContain(t('kill.tray'));
    const note = tauri.invoke.mock.calls.find(([cmd]) => cmd === 'notify_show');
    expect(note?.[1]).toMatchObject({ kind: 'error', body: t('kill.notify') });
  });

  it('подключение восстановлено — флаг гаснет', async () => {
    const view = await probe({ [KILL_SWITCH_SETTING]: true });
    await act(async () => {
      tauri.handlers.get('proxy-kept')?.();
      await Promise.resolve();
    });
    expect(isProxyKept()).toBe(true);
    view.unmount();
    await probe({ [KILL_SWITCH_SETTING]: true }, CoreState.CONNECTED);
    expect(isProxyKept()).toBe(false);
  });

  it('после размонтирования подписки на событие нет (C)', async () => {
    const view = await probe({ [KILL_SWITCH_SETTING]: true });
    await flush();
    expect(tauri.handlers.has('proxy-kept')).toBe(true);
    view.unmount();
    await flush();
    expect(tauri.handlers.has('proxy-kept')).toBe(false);
  });
});
