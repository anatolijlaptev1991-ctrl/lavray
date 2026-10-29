// screen_settings.test.tsx — «Настройки»: числовые поля не пишут 0 (T-34).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import { SettingValueSchema } from '../gen/lavray_pb';
import type { SettingValue } from '../gen/lavray_pb';
import { CoreContext } from '../hooks/useCore';
import type { CoreClients } from '../lib/core';
import { setLanguage } from '../lib/i18n';
import { SettingsScreen } from './screen_settings';

const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('SettingsScreen: числовые поля', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  const setSettings = vi.fn();

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setLanguage('en');
    setSettings.mockResolvedValue({ acceptedKeys: ['inbound.port', 'tun.mtu'] });
    const int = (n: number): SettingValue =>
      create(SettingValueSchema, { value: { case: 'intValue', value: BigInt(n) } });
    const clients = {
      settings: {
        describeSettings: vi.fn().mockResolvedValue({ descriptors: [] }),
        getSettings: vi.fn().mockResolvedValue({ values: { 'inbound.port': int(2080), 'tun.mtu': int(9000) } }),
        setSettings,
      },
      core: { getStatus: vi.fn().mockResolvedValue({ coreVersion: '0.1.0' }) },
    } as unknown as CoreClients;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(createElement(CoreContext.Provider, { value: clients }, createElement(SettingsScreen)));
    });
    await flush();
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.resetAllMocks();
  });

  /** Ввод в поле и уход из него (blur), как делает пользователь. */
  async function enter(id: string, text: string): Promise<HTMLInputElement> {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (input === null) throw new Error(`нет поля ${id}`);
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    act(() => {
      descriptor?.set?.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await flush();
    return input;
  }

  it('пустой порт не уходит в ядро как 0: ошибка и возврат прежнего значения', async () => {
    const input = await enter('inbound.port', '');
    expect(setSettings).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('1 to 65535');
    expect(input.value).toBe('2080');
  });

  it('порт вне диапазона и не число не отправляются; корректный — отправляется', async () => {
    for (const bad of ['0', '99999', '12ab', '-5']) {
      await enter('inbound.port', bad);
    }
    expect(setSettings).not.toHaveBeenCalled();
    const input = await enter('inbound.port', '8080');
    expect(setSettings).toHaveBeenCalledTimes(1);
    const sent = (setSettings.mock.calls[0]?.[0] as { values: Record<string, { value: { value: bigint } }> }).values;
    expect(sent['inbound.port']?.value.value).toBe(8080n);
    expect(input.value).toBe('8080');
  });

  it('другие целые поля: пустое значение отклоняется своим сообщением', async () => {
    const input = await enter('tun.mtu', '   ');
    expect(setSettings).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('whole number');
    expect(input.value).toBe('9000');
  });

  it('отказ ядра возвращает поле к принятому значению и показывает ошибку', async () => {
    setSettings.mockRejectedValue(new Error('[invalid_argument] inbound.port: значение вне диапазона'));
    const input = await enter('inbound.port', '1234');
    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('inbound.port');
    expect(input.value).toBe('2080');
  });
});
