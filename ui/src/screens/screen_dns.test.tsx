// screen_dns.test.tsx — экран «DNS»: кнопка «Перезапустить ядро» (T-28).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import { DnsSettingsSchema, DnsSettings_Mode } from '../gen/lavray_pb';
import { CoreContext } from '../hooks/useCore';
import type { CoreClients } from '../lib/core';
import { setLanguage } from '../lib/i18n';
import { DnsScreen } from './screen_dns';

const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('DnsScreen: перезапуск ядра', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  const getDns = vi.fn();
  const setDns = vi.fn();
  const restartProfile = vi.fn();

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setLanguage('en');
    getDns.mockResolvedValue(
      create(DnsSettingsSchema, {
        mode: DnsSettings_Mode.SIMPLE,
        remoteDns: 'https://dns.google/dns-query',
        directDns: 'local',
      }),
    );
    // Выбор карточки при активном соединении просит перезапуск.
    setDns.mockResolvedValue({ needsProfileRestart: true, applied: undefined, newRevision: 0 });
    restartProfile.mockResolvedValue({});
    const clients = {
      dns: { getDns, setDns, validateDnsJson: vi.fn() },
      core: { restartProfile },
    } as unknown as CoreClients;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(createElement(CoreContext.Provider, { value: clients }, createElement(DnsScreen)));
    });
    await flush();
    // Выбор карточки «Local» показывает баннер «нужен перезапуск».
    const card = container.querySelectorAll<HTMLButtonElement>('.dns-card')[4];
    act(() => {
      card?.click();
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

  const restartButton = (): HTMLButtonElement | null =>
    container.querySelector<HTMLButtonElement>('.restart-banner .btn-sec');

  it('вызывает CoreService.RestartProfile один раз и прячет баннер только после успеха', async () => {
    let finish: (v: unknown) => void = () => undefined;
    restartProfile.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    expect(container.querySelector('.restart-banner')).not.toBeNull();
    act(() => {
      restartButton()?.click();
    });
    expect(restartProfile).toHaveBeenCalledTimes(1);
    // Пока ядро перезапускается: кнопка заблокирована, баннер на месте.
    expect(restartButton()?.disabled).toBe(true);
    expect(restartButton()?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('.restart-banner')).not.toBeNull();

    await act(async () => {
      finish({});
      await Promise.resolve();
    });
    await flush();
    expect(container.querySelector('.restart-banner')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('при отказе ядра показывает ошибку в баннере и оставляет «Перезапустить»', async () => {
    restartProfile.mockRejectedValue(new Error('[invalid_argument] inbound.address: нужен пароль'));
    act(() => {
      restartButton()?.click();
    });
    await flush();
    expect(restartProfile).toHaveBeenCalledTimes(1);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('inbound.address');
    expect(container.querySelector('.restart-banner')).not.toBeNull();
    expect(restartButton()?.disabled).toBe(false);
  });
});
