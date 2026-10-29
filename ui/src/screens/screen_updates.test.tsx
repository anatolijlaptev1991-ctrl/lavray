// SPDX-License-Identifier: GPL-3.0-only

// screen_updates.test.tsx — регрессия T-72: экран «Обновления» помечает
// обязательное обновление словом «Обязательное» (а не «Бета»), помнит выбранный
// канал (настройка update.channel) и, пока подсистема обновлений не подключена
// (ядро отвечает failed_precondition), честно пишет «Проверка обновлений пока
// недоступна» вместо красной ошибки.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { CoreContext } from '../hooks/useCore';
import type { CoreClients } from '../lib/core';
import { setLanguage } from '../lib/i18n';
import {
  CheckUpdatesResponseSchema,
  ComponentUpdateSchema,
  GetSettingsResponseSchema,
  SettingValueSchema,
  UpdateChannel,
  UpdateComponent,
  UpdateStateResponseSchema,
} from '../gen/lavray_pb';
import { UpdatesScreen } from './screen_updates';

const EMPTY_CHECK = (): Promise<unknown> => Promise.resolve(create(CheckUpdatesResponseSchema, {}));
const EMPTY_STATE = (): Promise<unknown> => Promise.resolve(create(UpdateStateResponseSchema, {}));
const unconfigured = (): Promise<never> =>
  Promise.reject(new ConnectError('обновления не сконфигурированы', Code.FailedPrecondition));

describe('экран «Обновления» (T-72)', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setLanguage('ru');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    setLanguage('en');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  const settle = async (): Promise<void> => {
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  };
  const checkBtn = (): HTMLButtonElement =>
    Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Проверить сейчас')!;
  const select = (): HTMLSelectElement => document.querySelector<HTMLSelectElement>('#updCh')!;

  /** Монтирует экран; check/state — ответы ядра, channel — сохранённое значение update.channel. */
  async function mount(
    f: { check?: () => Promise<unknown>; state?: () => Promise<unknown>; channel?: string } = {},
  ): Promise<{ check: ReturnType<typeof vi.fn>; setSettings: ReturnType<typeof vi.fn> }> {
    const check = vi.fn(f.check ?? EMPTY_CHECK);
    const setSettings = vi.fn(() => Promise.resolve({}));
    const stored = f.channel === undefined ? {} : { 'update.channel': create(SettingValueSchema, { value: { case: 'stringValue', value: f.channel } }) };
    const core = {
      updates: { getUpdateState: vi.fn(f.state ?? EMPTY_STATE), checkUpdates: check },
      settings: { getSettings: vi.fn(() => Promise.resolve(create(GetSettingsResponseSchema, { values: stored }))), setSettings },
    } as unknown as CoreClients;
    act(() => {
      root.render(createElement(CoreContext.Provider, { value: core }, createElement(UpdatesScreen)));
    });
    await settle();
    return { check, setSettings };
  }

  async function clickCheck(): Promise<void> {
    act(() => {
      checkBtn().click();
    });
    await settle();
  }

  it('обязательное обновление помечено «Обязательное», а не «Бета»', async () => {
    const app = create(ComponentUpdateSchema, {
      component: UpdateComponent.APP,
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      mandatory: true,
    });
    await mount({ check: () => Promise.resolve(create(CheckUpdatesResponseSchema, { available: [app] })) });
    await clickCheck();
    expect(document.querySelector('.upd-row .badge')?.textContent).toBe('Обязательное');
  });

  it('канал берётся из настройки update.channel и сохраняется при выборе', async () => {
    const { check, setSettings } = await mount({ channel: 'beta' });
    expect(select().value).toBe(String(UpdateChannel.BETA));
    act(() => {
      select().value = String(UpdateChannel.STABLE);
      select().dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    const sent = (setSettings.mock.calls[0] as unknown as [{ values: Record<string, unknown> }])[0].values;
    expect(sent['update.channel']).toMatchObject({ value: { case: 'stringValue', value: 'stable' } });
    await clickCheck();
    expect(check.mock.calls[0]?.[0]).toMatchObject({ channel: UpdateChannel.STABLE });
  });

  it('пока подсистема не подключена (failed_precondition) — спокойное сообщение вместо ошибки', async () => {
    await mount({ check: unconfigured });
    await clickCheck();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Проверка обновлений пока недоступна');
    expect(checkBtn().disabled).toBe(true);
  });

  it('то же сообщение показывается сразу, если состояние подсистемы недоступно при открытии', async () => {
    await mount({ state: unconfigured });
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Проверка обновлений пока недоступна');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
