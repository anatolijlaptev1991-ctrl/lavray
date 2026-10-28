// screen_dns_cards.test.tsx — экран «DNS»: карточки режимов (T-31).
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

const IDS = ['auto', 'tunnel', 'doh', 'dot', 'local'];

describe('DnsScreen: карточки', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  const getDns = vi.fn();
  const setDns = vi.fn();

  async function show(init: Parameters<typeof create<typeof DnsSettingsSchema>>[1]): Promise<void> {
    getDns.mockResolvedValue(create(DnsSettingsSchema, init));
    setDns.mockResolvedValue({ needsProfileRestart: false, applied: undefined, newRevision: 0 });
    const clients = { dns: { getDns, setDns, validateDnsJson: vi.fn() }, core: {} } as unknown as CoreClients;
    act(() => {
      root?.render(createElement(CoreContext.Provider, { value: clients }, createElement(DnsScreen)));
    });
    await flush();
  }

  const cards = (): HTMLButtonElement[] => Array.from(container.querySelectorAll<HTMLButtonElement>('.dns-card'));
  const active = (): string[] =>
    cards()
      .map((c, i) => (c.getAttribute('aria-pressed') === 'true' ? (IDS[i] ?? '?') : ''))
      .filter((x) => x !== '');

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setLanguage('en');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.resetAllMocks();
  });

  it('каждая карточка отправляет свой choice, адреса выбирает ядро', async () => {
    await show({ mode: DnsSettings_Mode.SIMPLE, choice: 'auto', remoteDns: 'https://dns.google/dns-query' });
    for (const [i, id] of IDS.entries()) {
      act(() => {
        cards()[i]?.click();
      });
      await flush();
      const sent = (setDns.mock.calls.at(-1)?.[0] as { dns: Record<string, unknown> }).dns;
      expect(sent.choice).toBe(id);
      expect(sent.mode).toBe(DnsSettings_Mode.SIMPLE);
      expect(sent.remoteDns).toBeUndefined();
    }
  });

  it('подсвечивает карточку по choice ядра, а не по префиксу адреса', async () => {
    // «Авто» с адресом https:// раньше подсвечивало «DoH».
    await show({ mode: DnsSettings_Mode.SIMPLE, choice: 'auto', remoteDns: 'https://dns.google/dns-query' });
    expect(active()).toEqual(['auto']);
    await show({ mode: DnsSettings_Mode.SIMPLE, choice: 'tunnel', remoteDns: 'https://dns.google/dns-query' });
    expect(active()).toEqual(['tunnel']);
    await show({ mode: DnsSettings_Mode.SIMPLE, choice: 'doh', remoteDns: 'https://dns.google/dns-query' });
    expect(active()).toEqual(['doh']);
    await show({ mode: DnsSettings_Mode.SIMPLE, choice: 'custom', remoteDns: 'https://dns.example/q' });
    expect(active()).toEqual([]);
    await show({ mode: DnsSettings_Mode.ADVANCED, advancedJson: '{}' });
    expect(active()).toEqual([]);
  });

  it('свои серверы сохраняются как custom; ошибка адреса показывается в баннере', async () => {
    await show({ mode: DnsSettings_Mode.SIMPLE, choice: 'auto', remoteDns: 'https://dns.google/dns-query' });
    setDns.mockRejectedValue(new Error('[invalid_argument] remote_dns: схема "ftp" не поддерживается'));
    act(() => {
      container.querySelector<HTMLButtonElement>('.srv-import-row .btn-pri')?.click();
    });
    await flush();
    const sent = (setDns.mock.calls.at(-1)?.[0] as { dns: Record<string, unknown> }).dns;
    expect(sent.choice).toBe('custom');
    expect(sent.remoteDns).toBe('https://dns.google/dns-query');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('remote_dns');
  });

  it('в режиме JSON предупреждает, что FakeIP не применяется', async () => {
    await show({ mode: DnsSettings_Mode.ADVANCED, advancedJson: '{"servers":[]}', fakeDnsEnabled: true });
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(container.querySelector('[role="note"]')?.textContent).toContain('FakeIP');
    await show({ mode: DnsSettings_Mode.ADVANCED, advancedJson: '{"servers":[]}', fakeDnsEnabled: false });
    expect(container.querySelector('[role="note"]')).toBeNull();
  });
});
