// SPDX-License-Identifier: GPL-3.0-only

// AutoConnectRow.test.tsx — переключатель автоподключения пишет remember.enable
// в ядро, по умолчанию выключен, доступен с клавиатуры и с подписями для
// скринридера; в веб-панели строки нет.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { SettingValueSchema } from '../../gen/lavray_pb';
import { LANGUAGES, setLanguage, t } from '../../lib/i18n';
import { click, flush, mountBare, unmountAll } from '../../test-utils/coreStub';
import { AutoConnectRow } from './AutoConnectRow';

const h = vi.hoisted(() => ({
  getSettings: vi.fn<(req: unknown) => Promise<{ values: Record<string, unknown> }>>(),
  setSettings: vi.fn<(req: { values: Record<string, { value: unknown }> }) => Promise<unknown>>(),
}));
vi.mock('../../hooks/useCore', () => {
  const clients = { settings: { getSettings: h.getSettings, setSettings: h.setSettings } }; // стабильный, как useMemo
  return { useCore: (): unknown => clients };
});

const flag = (value: boolean): unknown => create(SettingValueSchema, { value: { case: 'boolValue', value } });
const sw = (): HTMLElement | null => document.querySelector<HTMLElement>('#autoConnectRow [role="switch"]');

beforeEach(() => {
  setLanguage('en');
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  h.getSettings.mockReset().mockResolvedValue({ values: {} });
  h.setSettings.mockReset().mockResolvedValue({});
});

afterEach(() => {
  unmountAll();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe('AutoConnectRow', () => {
  it('по умолчанию выключен (ключа нет в базе)', async () => {
    await mountBare(createElement(AutoConnectRow));
    await flush();
    expect(sw()?.getAttribute('aria-checked')).toBe('false');
    expect(h.getSettings).toHaveBeenCalledWith({ keys: ['remember.enable'] });
  });

  it('читает включённое значение ядра', async () => {
    h.getSettings.mockResolvedValue({ values: { 'remember.enable': flag(true) } });
    await mountBare(createElement(AutoConnectRow));
    await flush();
    expect(sw()?.getAttribute('aria-checked')).toBe('true');
  });

  it('переключение пишет remember.enable через SetSettings', async () => {
    await mountBare(createElement(AutoConnectRow));
    await flush();
    await click(sw());
    await flush();
    expect(h.setSettings).toHaveBeenCalledTimes(1);
    expect(h.setSettings.mock.calls[0]?.[0].values['remember.enable']?.value).toEqual({ case: 'boolValue', value: true });
    expect(sw()?.getAttribute('aria-checked')).toBe('true');
    await click(sw());
    await flush();
    expect(h.setSettings.mock.calls[1]?.[0].values['remember.enable']?.value).toEqual({ case: 'boolValue', value: false });
    expect(sw()?.getAttribute('aria-checked')).toBe('false');
  });

  it('сбой записи оставляет прежнее значение и сообщает текстом', async () => {
    h.setSettings.mockRejectedValue(new Error('down'));
    await mountBare(createElement(AutoConnectRow));
    await flush();
    await click(sw());
    await flush();
    expect(sw()?.getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(t('set.autoConnect.failed', 'en'));
  });

  it('до чтения значения переключатель недоступен', async () => {
    h.getSettings.mockReturnValue(new Promise(() => undefined));
    await mountBare(createElement(AutoConnectRow));
    expect((sw() as HTMLButtonElement | null)?.disabled).toBe(true);
  });

  it('подписи для скринридера: имя и описание связаны с переключателем', async () => {
    await mountBare(createElement(AutoConnectRow));
    await flush();
    const button = sw();
    const label = document.getElementById(button?.getAttribute('aria-labelledby') ?? '');
    const desc = document.getElementById(button?.getAttribute('aria-describedby') ?? '');
    expect(label?.textContent).toBe('Connect automatically at startup');
    expect(desc?.textContent ?? '').toMatch(/last server and mode/);
    expect(desc?.textContent ?? '').toMatch(/TUN needs autostart with administrator rights/);
  });

  it('в веб-панели (вне оболочки) строки нет и ядро не опрашивается', async () => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    await mountBare(createElement(AutoConnectRow));
    await flush();
    expect(document.querySelector('#autoConnectRow')).toBeNull();
    expect(h.getSettings).not.toHaveBeenCalled();
  });

  it('тексты есть во всех пяти языках и не называют сторонний продукт', () => {
    for (const lang of LANGUAGES) {
      for (const key of ['set.autoConnect', 'set.autoConnect.d', 'set.autoConnect.failed'] as const) {
        expect(t(key, lang), `${lang}:${key}`).not.toBe(key);
        expect(t(key, lang)).not.toMatch(/happ/i);
      }
    }
  });
});
