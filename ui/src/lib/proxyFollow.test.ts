// SPDX-License-Identifier: GPL-3.0-only

// proxyFollow.test.ts — правила «окно следует за ядром» (MCP): когда окно ставит
// и снимает системный прокси после чужого подключения.
import { describe, expect, it } from 'vitest';
import { ConnectMode, CoreState } from '../gen/lavray_pb';
import { followAction, type FollowInput } from './proxyFollow';

const base: FollowInput = {
  prev: CoreState.IDLE,
  next: CoreState.CONNECTED,
  mode: ConnectMode.SYSTEM_PROXY,
  sysProxyWanted: true,
  applied: false,
  busy: false,
};

describe('followAction', () => {
  it('подключилось извне в режиме системного прокси — применить', () => {
    expect(followAction(base)).toBe('apply');
    // через промежуточное «подключается» — тоже смена состояния
    expect(followAction({ ...base, prev: CoreState.CONNECTING })).toBe('apply');
  });

  it('прокси ставится при включённом «Системном прокси» и в режиме TUN, как у кнопки подключения', () => {
    expect(followAction({ ...base, mode: ConnectMode.TUN })).toBe('apply');
  });

  it('не ставит, если пользователь выключил «Системный прокси»', () => {
    expect(followAction({ ...base, sysProxyWanted: false })).toBeNull();
  });

  it('не ставит в режимах шлюза и при неизвестном режиме', () => {
    for (const mode of [ConnectMode.GATEWAY_TPROXY, ConnectMode.GATEWAY_TUN, ConnectMode.UNSPECIFIED]) {
      expect(followAction({ ...base, mode }), String(mode)).toBeNull();
    }
  });

  it('уже применённый прокси не ставится повторно', () => {
    expect(followAction({ ...base, applied: true })).toBeNull();
  });

  it('отключилось или упало — снять, если окно его ставило', () => {
    for (const next of [CoreState.IDLE, CoreState.ERROR]) {
      expect(followAction({ ...base, prev: CoreState.CONNECTED, next, applied: true }), String(next)).toBe('release');
    }
  });

  it('нечего снимать — ничего не делает', () => {
    expect(followAction({ ...base, prev: CoreState.CONNECTED, next: CoreState.IDLE, applied: false })).toBeNull();
  });

  it('прокси не трогают промежуточные состояния: отключение ещё идёт, переподключение', () => {
    for (const next of [CoreState.DISCONNECTING, CoreState.CONNECTING, CoreState.RECONNECTING]) {
      expect(followAction({ ...base, prev: CoreState.CONNECTED, next, applied: true }), String(next)).toBeNull();
    }
  });

  it('действует на смену состояния, а не на само состояние', () => {
    expect(followAction({ ...base, prev: CoreState.CONNECTED })).toBeNull();
    expect(followAction({ ...base, prev: CoreState.IDLE, next: CoreState.IDLE, applied: true })).toBeNull();
  });

  it('первый кадр после запуска окна ничего не меняет', () => {
    expect(followAction({ ...base, prev: null })).toBeNull();
    expect(followAction({ ...base, prev: null, next: CoreState.IDLE, applied: true })).toBeNull();
  });

  it('пока идёт собственное подключение окна, не вмешивается', () => {
    expect(followAction({ ...base, busy: true })).toBeNull();
    expect(followAction({ ...base, prev: CoreState.CONNECTED, next: CoreState.IDLE, applied: true, busy: true })).toBeNull();
  });
});
