// SPDX-License-Identifier: GPL-3.0-only

// killSwitch.test.ts — зеркало настройки для оболочки и флаг «прокси оставлен».
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KILL_SWITCH_KEY,
  KILL_SWITCH_SETTING,
  clearProxyKept,
  isProxyKept,
  killSwitchOn,
  listenProxyKept,
  markProxyKept,
  mirrorKillSwitch,
  subscribeProxyKept,
} from './killSwitch';
import { UI_STATE_KEYS } from './uiState';

afterEach(() => {
  clearProxyKept();
  window.localStorage.clear();
});

describe('killSwitch: зеркало для оболочки', () => {
  it('ключ зеркала входит в общий список ui-state.json (оболочка читает только его)', () => {
    expect(UI_STATE_KEYS).toContain(KILL_SWITCH_KEY);
    expect(KILL_SWITCH_KEY).toBe('lavray.killSwitchProxy');
  });

  it('пишет "1" и "0", как остальные флаги оболочки', () => {
    expect(mirrorKillSwitch(true)).toBe(true);
    expect(window.localStorage.getItem(KILL_SWITCH_KEY)).toBe('1');
    expect(mirrorKillSwitch(false)).toBe(true);
    expect(window.localStorage.getItem(KILL_SWITCH_KEY)).toBe('0');
  });

  it('хранилище недоступно (приватный режим) — false, без исключения', () => {
    const broken = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage;
    expect(mirrorKillSwitch(true, broken)).toBe(false);
  });

  it('настройка читается из значений ядра; нет значения — выключено', () => {
    expect(killSwitchOn({})).toBe(false);
    expect(killSwitchOn({ [KILL_SWITCH_SETTING]: false })).toBe(false);
    expect(killSwitchOn({ [KILL_SWITCH_SETTING]: true })).toBe(true);
    expect(killSwitchOn({ [KILL_SWITCH_SETTING]: 'true' })).toBe(false);
  });
});

describe('killSwitch: флаг «прокси оставлен»', () => {
  it('ставится, снимается и сообщает подписчикам только об изменении', () => {
    const seen = vi.fn();
    const stop = subscribeProxyKept(seen);
    markProxyKept();
    markProxyKept();
    expect(isProxyKept()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    clearProxyKept();
    expect(isProxyKept()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    stop();
    markProxyKept();
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('вне окна приложения подписка на событие оболочки ничего не делает', async () => {
    const stop = await listenProxyKept(() => undefined);
    expect(stop).toBeTypeOf('function');
    stop();
  });
});
