// SPDX-License-Identifier: GPL-3.0-only

// useSettingsSync.test.tsx — живая карта настроек: GetSettings + SubscribeSettings,
// перечитывание после подписки и после ABORTED, повтор с паузой, остановка при
// размонтировании. Ядро подставное (fetch), поток управляется ответами маршрута.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { setLanguage } from '../lib/i18n';
import { flush, mount, stubCore, unmountAll } from '../test-utils/coreStub';
import type { Json } from '../test-utils/coreStub';
import { StreamReply } from '../test-utils/streamStub';
import { BACKOFF_FIRST_MS, BACKOFF_MAX_MS, nextBackoff, useSettingsSync } from './useSettingsSync';
import type { SettingsMap } from './useSettingsSync';

let latest: SettingsMap = {};

function Probe(): null {
  latest = useSettingsSync();
  return null;
}

const on = (key: string, value: boolean): Json => ({ values: { [key]: { boolValue: value } } });

beforeEach(() => {
  setLanguage('en');
  latest = {};
});

afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
});

describe('useSettingsSync', () => {
  it('сразу после подписки перечитывает GetSettings (начального кадра у потока нет)', async () => {
    const core = stubCore({
      'SettingsService/GetSettings': on('connect.kill_switch_proxy', true),
      'SettingsService/SubscribeSettings': new StreamReply([], { hold: true }),
    });
    await mount(createElement(Probe));
    expect(latest['connect.kill_switch_proxy']).toBe(true);
    expect(core.bodies('SettingsService/GetSettings')).toHaveLength(1);
    expect(core.bodies('SettingsService/SubscribeSettings')).toHaveLength(1);
  });

  it('события потока обновляют карту: изменённое заменяется, сброшенное к умолчанию убирается', async () => {
    stubCore({
      'SettingsService/GetSettings': {
        values: { 'mux.protocol': { stringValue: 'h2mux' }, 'log.level': { stringValue: 'info' } },
      },
      'SettingsService/SubscribeSettings': new StreamReply(
        [{ changed: { 'mux.protocol': { stringValue: 'smux' } }, removed: ['log.level'] }],
        { hold: true },
      ),
    });
    await mount(createElement(Probe));
    expect(latest['mux.protocol']).toBe('smux');
    expect(latest['log.level']).toBeUndefined();
  });

  it('ABORTED: подписка возобновляется, карта перечитывается, пропущенное догоняется (R)', async () => {
    let reads = 0;
    const core = stubCore({
      'SettingsService/GetSettings': () => on('connect.kill_switch_proxy', ++reads > 1),
      'SettingsService/SubscribeSettings': (call) =>
        call === 0
          ? new StreamReply([], { error: { code: 'aborted', message: 'slow subscriber' } })
          : new StreamReply([], { hold: true }),
    });
    await mount(createElement(Probe));
    expect(latest['connect.kill_switch_proxy']).toBe(false);
    await flush(BACKOFF_FIRST_MS + 400);
    expect(core.bodies('SettingsService/SubscribeSettings')).toHaveLength(2);
    expect(core.bodies('SettingsService/GetSettings')).toHaveLength(2);
    expect(latest['connect.kill_switch_proxy']).toBe(true);
  });

  it('ядро недоступно: ошибка не выходит наружу, повтор не быстрее паузы (X)', async () => {
    const core = stubCore({
      'SettingsService/GetSettings': { values: {} },
      'SettingsService/SubscribeSettings': new StreamReply([], { error: { code: 'unavailable', message: 'down' } }),
    });
    await mount(createElement(Probe));
    expect(core.bodies('SettingsService/SubscribeSettings')).toHaveLength(1);
    await flush(100);
    expect(core.bodies('SettingsService/SubscribeSettings')).toHaveLength(1);
  });

  it('после размонтирования новых подписок нет (C)', async () => {
    const core = stubCore({
      'SettingsService/GetSettings': { values: {} },
      'SettingsService/SubscribeSettings': new StreamReply([], { error: { code: 'aborted' } }),
    });
    const view = await mount(createElement(Probe));
    view.unmount();
    await flush(BACKOFF_FIRST_MS + 300);
    expect(core.bodies('SettingsService/SubscribeSettings')).toHaveLength(1);
  });
});

describe('nextBackoff', () => {
  it('первая пауза — BACKOFF_FIRST_MS, дальше вдвое, но не больше предела', () => {
    expect(nextBackoff(0)).toBe(BACKOFF_FIRST_MS);
    expect(nextBackoff(BACKOFF_FIRST_MS)).toBe(BACKOFF_FIRST_MS * 2);
    expect(nextBackoff(BACKOFF_MAX_MS)).toBe(BACKOFF_MAX_MS);
    expect(nextBackoff(BACKOFF_MAX_MS - 1)).toBe(BACKOFF_MAX_MS);
  });
});
