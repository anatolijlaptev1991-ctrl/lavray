// SPDX-License-Identifier: GPL-3.0-only

// tauriStub.test.ts — подставка оболочки Tauri: ответы команд, журнал вызовов,
// события и подключение через vi.mock к настоящим импортам '@tauri-apps/api/*'.
import { emit as tauriEmit, listen as tauriListen } from '@tauri-apps/api/event';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disableTauri, enableTauri, tauri } from './tauriStub';

vi.mock('@tauri-apps/api/core', async () => (await import('./tauriStub')).tauriCoreModule);
vi.mock('@tauri-apps/api/event', async () => (await import('./tauriStub')).tauriEventModule);

beforeEach(() => {
  tauri.reset();
});

afterEach(() => {
  disableTauri();
});

describe('команды', () => {
  it('onValue: команда отвечает значением (H)', async () => {
    tauri.onValue('autostart_state', { supported: true, enabled: false });
    await expect(tauri.invoke('autostart_state')).resolves.toEqual({ supported: true, enabled: false });
  });

  it('onCall: функция получает аргументы, ответ может быть промисом (H)', async () => {
    tauri.onCall('echo', (args) => Promise.resolve({ got: args }));
    await expect(tauri.invoke('echo', { a: 1 })).resolves.toEqual({ got: { a: 1 } });
  });

  it('onError: команда отклоняется значением как есть — строкой, как Err(String) оболочки (I)', async () => {
    tauri.onError('tray_update', 'нет трея');
    await expect(tauri.invoke('tray_update')).rejects.toBe('нет трея');
  });

  it('onCall: исключение в обработчике — отказ команды (I)', async () => {
    tauri.onCall('boom', () => {
      throw new Error('сбой');
    });
    await expect(tauri.invoke('boom')).rejects.toThrow('сбой');
  });

  it('команда без ответа отклоняется понятным сообщением с её именем (I)', async () => {
    await expect(tauri.invoke('no_such_cmd')).rejects.toThrow(/no_such_cmd.*нет ответа/);
  });

  it('onRaw: ответ — ArrayBuffer с теми же байтами, копия не делит память с источником (B)', async () => {
    const src = new Uint8Array([1, 2, 3]);
    tauri.onRaw('backup_export', src);
    const got = await tauri.invoke<ArrayBuffer>('backup_export');
    expect(ArrayBuffer.isView(got)).toBe(false);
    expect(Array.from(new Uint8Array(got))).toEqual([1, 2, 3]);
    src[0] = 9;
    expect(Array.from(new Uint8Array(got))).toEqual([1, 2, 3]);
    tauri.onRaw('empty', []);
    expect((await tauri.invoke<ArrayBuffer>('empty')).byteLength).toBe(0);
  });

  it('журнал хранит вызовы по порядку, в том числе неудачные (H)', async () => {
    tauri.onValue('a', 1).onError('b', 'нет');
    await tauri.invoke('a', { x: 1 });
    await tauri.invoke('b').catch(() => undefined);
    await tauri.invoke('missing').catch(() => undefined);
    await tauri.invoke('a');
    expect(tauri.calls).toEqual([
      { cmd: 'a', args: { x: 1 } },
      { cmd: 'b', args: undefined },
      { cmd: 'missing', args: undefined },
      { cmd: 'a', args: undefined },
    ]);
    expect(tauri.argsOf('a')).toEqual([{ x: 1 }, undefined]);
  });

  it('журнал снаружи не правит внутренний (S)', async () => {
    tauri.onValue('a', 1);
    await tauri.invoke('a');
    (tauri.calls as unknown[]).length = 0;
    expect(tauri.calls).toHaveLength(1);
  });
});

describe('события', () => {
  it('emit доходит до слушателей по порядку подписки, payload и имя на месте (H)', async () => {
    const seen: string[] = [];
    await tauri.listen<{ n: number }>('core-endpoint', (e) => seen.push(`1:${e.event}:${String(e.payload.n)}`));
    await tauri.listen<{ n: number }>('core-endpoint', (e) => seen.push(`2:${String(e.payload.n)}`));
    expect(tauri.emit('core-endpoint', { n: 7 })).toBe(2);
    expect(seen).toEqual(['1:core-endpoint:7', '2:7']);
  });

  it('unlisten снимает только своего слушателя; повторный вызов безвреден (D)', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = await tauri.listen('tick', a);
    await tauri.listen('tick', b);
    offA();
    offA();
    expect(tauri.listenerCount('tick')).toBe(1);
    tauri.emit('tick', 1);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it('событие без слушателей — 0 доставок, другие имена не задеты (E)', async () => {
    const other = vi.fn();
    await tauri.listen('other', other);
    expect(tauri.emit('tick')).toBe(0);
    expect(other).not.toHaveBeenCalled();
  });

  it('once снимается после первого события (B)', async () => {
    const handler = vi.fn();
    await tauri.once('tick', handler);
    tauri.emit('tick', 1);
    tauri.emit('tick', 2);
    expect(handler).toHaveBeenCalledOnce();
    expect(tauri.listenerCount('tick')).toBe(0);
  });
});

describe('окружение', () => {
  it('enableTauri / disableTauri переключают window.__TAURI_INTERNALS__ (P)', () => {
    const has = (): boolean => '__TAURI_INTERNALS__' in window;
    expect(has()).toBe(false);
    enableTauri();
    expect(has()).toBe(true);
    disableTauri();
    expect(has()).toBe(false);
  });

  it('reset чистит журнал, ответы, подписки и признак оболочки (D)', async () => {
    enableTauri();
    tauri.onValue('a', 1);
    await tauri.invoke('a');
    await tauri.listen('tick', vi.fn());
    tauri.reset();
    expect(tauri.calls).toEqual([]);
    expect(tauri.listenerCount('tick')).toBe(0);
    expect('__TAURI_INTERNALS__' in window).toBe(false);
    await expect(tauri.invoke('a')).rejects.toThrow(/нет ответа/);
  });
});

describe('подключение через vi.mock', () => {
  it('настоящие импорты @tauri-apps/api/core и /event попадают в подставку (H)', async () => {
    tauri.onValue('core_endpoint', ['127.0.0.1:50001', 'tok']);
    await expect(tauriInvoke<[string, string]>('core_endpoint')).resolves.toEqual(['127.0.0.1:50001', 'tok']);

    const seen: unknown[] = [];
    const off = await tauriListen('core-endpoint', (e) => seen.push(e.payload));
    await tauriEmit('core-endpoint', 'p1');
    off();
    await tauriEmit('core-endpoint', 'p2');

    expect(seen).toEqual(['p1']);
    expect(tauri.argsOf('core_endpoint')).toEqual([undefined]);
  });
});
