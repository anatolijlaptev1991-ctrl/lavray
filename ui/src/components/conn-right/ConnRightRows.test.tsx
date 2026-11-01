// SPDX-License-Identifier: GPL-3.0-only

// ConnRightRows.test.tsx — строки «Внешний IP» и «Удалённый DNS» правой панели
// «Подключение» (хвосты B, 7.2): IP через туннель после подключения с кэшем на 5 минут,
// ошибка с повтором, подпись DNS по настройкам активного набора.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { DnsSettingsSchema, DnsSettings_Mode } from '../../gen/lavray_pb';
import { resetPublicIpCache } from '../../hooks/usePublicIp';
import { dnsHost, dnsLabel } from '../../lib/dnsLabel';
import { setLanguage, t } from '../../lib/i18n';
import { Failure, click, flush, mount, stubCore, unmountAll } from '../../test-utils/coreStub';
import type { Json } from '../../test-utils/coreStub';
import { ConnRight } from '../ConnRight';
import { DnsRow } from './DnsRow';

beforeEach(() => {
  setLanguage('en');
  resetPublicIpCache();
});

afterEach(() => {
  unmountAll();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ipCell = (c: HTMLElement): HTMLElement | null => c.querySelector('#hlIp');
const ipText = (c: HTMLElement): string => ipCell(c)?.querySelector('.mono')?.textContent ?? '';
const refresh = (c: HTMLElement): HTMLElement | null =>
  ipCell(c)?.querySelector<HTMLElement>(`button[aria-label="${t('health.ip.refresh')}"]`) ?? null;

function panel(connected: boolean, session = '1:1'): ReturnType<typeof createElement> {
  return createElement(ConnRight, { connected, session, presetId: 'global', presetName: 'Global', presetRules: 1 });
}

const ROUTES: Record<string, Json> = {
  'DiagnosticsService/CheckLeaks': {},
  'DnsService/GetDns': { mode: 'MODE_SIMPLE', choice: 'tunnel' },
};

describe('PublicIpRow', () => {
  it('public_ip_via_tunnel_after_connect: после подключения спрашивает ядро «через туннель»', async () => {
    const core = stubCore({ ...ROUTES, 'DiagnosticsService/GetPublicIp': { ip: '198.51.100.9' } });
    const view = await mount(panel(true));

    expect(ipText(view.container)).toBe('198.51.100.9');
    expect(core.bodies('DiagnosticsService/GetPublicIp')).toEqual([{ via: 'VIA_THROUGH_TUNNEL' }]);
  });

  it('не подключено — IP не запрашивается, показано «—», кнопка недоступна', async () => {
    const core = stubCore({ ...ROUTES, 'DiagnosticsService/GetPublicIp': { ip: '198.51.100.9' } });
    const view = await mount(panel(false));

    expect(ipText(view.container)).toBe('—');
    expect(core.bodies('DiagnosticsService/GetPublicIp')).toHaveLength(0);
    expect(refresh(view.container)?.hasAttribute('disabled')).toBe(true);
  });

  it('public_ip_error_retry: ошибка видна, «Обновить» повторяет запрос и снимает ошибку (R)', async () => {
    const core = stubCore({
      ...ROUTES,
      'DiagnosticsService/GetPublicIp': (call) =>
        call === 0 ? new Failure('unavailable', 'нет ответа') : { ip: '203.0.113.5' },
    });
    const view = await mount(panel(true));
    expect(ipText(view.container)).toBe('—');
    expect(ipCell(view.container)?.querySelector('[role="alert"]')).not.toBeNull();

    await click(refresh(view.container));

    expect(ipText(view.container)).toBe('203.0.113.5');
    expect(ipCell(view.container)?.querySelector('[role="alert"]')).toBeNull();
    expect(core.bodies('DiagnosticsService/GetPublicIp')).toHaveLength(2);
  });

  it('ответ без IP — это ошибка, а не пустое значение (I)', async () => {
    stubCore({ ...ROUTES, 'DiagnosticsService/GetPublicIp': {} });
    const view = await mount(panel(true));
    expect(ipText(view.container)).toBe('—');
    expect(ipCell(view.container)?.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('кэш на 5 минут: повторное монтирование того же сеанса не спрашивает ядро, «Обновить» спрашивает (D)', async () => {
    const core = stubCore({ ...ROUTES, 'DiagnosticsService/GetPublicIp': { ip: '198.51.100.9' } });
    const first = await mount(panel(true));
    first.unmount();
    const second = await mount(panel(true));

    expect(ipText(second.container)).toBe('198.51.100.9');
    expect(core.bodies('DiagnosticsService/GetPublicIp')).toHaveLength(1);
    await click(refresh(second.container));
    expect(core.bodies('DiagnosticsService/GetPublicIp')).toHaveLength(2);
  });

  it('кэш просрочен через 5 минут (B)', async () => {
    const core = stubCore({ ...ROUTES, 'DiagnosticsService/GetPublicIp': { ip: '198.51.100.9' } });
    const first = await mount(panel(true));
    first.unmount();
    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 5 * 60_000 + 1);
    await mount(panel(true));

    expect(core.bodies('DiagnosticsService/GetPublicIp')).toHaveLength(2);
    vi.restoreAllMocks();
  });

  it('другой сеанс (переподключение к другому серверу) кэш не использует (D)', async () => {
    const core = stubCore({ ...ROUTES, 'DiagnosticsService/GetPublicIp': { ip: '198.51.100.9' } });
    const first = await mount(panel(true, '1:100'));
    first.unmount();
    await mount(panel(true, '2:200'));

    expect(core.bodies('DiagnosticsService/GetPublicIp')).toHaveLength(2);
  });

  it('отключились — значение уходит, поздний ответ не возвращает его (C)', async () => {
    stubCore({ ...ROUTES, 'DiagnosticsService/GetPublicIp': { ip: '198.51.100.9' } });
    const view = await mount(panel(true));
    expect(ipText(view.container)).toBe('198.51.100.9');
    await act(async () => {
      view.unmount();
      await Promise.resolve();
    });
    const off = await mount(panel(false));
    await flush();
    expect(ipText(off.container)).toBe('—');
  });
});

describe('DnsRow', () => {
  it('dns_label_from_preset: подпись берётся из настроек DNS активного набора', async () => {
    const core = stubCore({ 'DnsService/GetDns': { mode: 'MODE_SIMPLE', choice: 'tunnel' } });
    const view = await mount(createElement(DnsRow, { presetId: 'global' }));

    expect(view.container.querySelector('#hlDns .val')?.textContent).toBe(t('dns.tunnel'));
    expect(view.container.querySelector('#hlDns .cap')?.textContent).toBe('Remote DNS');
    expect(core.bodies('DnsService/GetDns')).toHaveLength(1);
  });

  it('dns_label_from_preset: смена набора перечитывает подпись', async () => {
    let call = 0;
    stubCore({
      'DnsService/GetDns': () => ({ mode: 'MODE_SIMPLE', choice: call++ === 0 ? 'tunnel' : 'local' }),
    });
    const view = await mount(createElement(DnsRow, { presetId: 'global' }));
    view.unmount();
    const next = await mount(createElement(DnsRow, { presetId: 'ru' }));
    expect(next.container.querySelector('#hlDns .val')?.textContent).toBe(t('dns.local'));
  });

  it('ядро не отвечает — «—» (E)', async () => {
    stubCore({ 'DnsService/GetDns': new Failure('unavailable', 'down') });
    const view = await mount(createElement(DnsRow, { presetId: 'global' }));
    expect(view.container.querySelector('#hlDns .val')?.textContent).toBe('—');
  });
});

describe('dnsLabel / dnsHost', () => {
  const dns = (init: Parameters<typeof create<typeof DnsSettingsSchema>>[1]): ReturnType<typeof create<typeof DnsSettingsSchema>> =>
    create(DnsSettingsSchema, init);

  it('карточки экрана DNS, свой адрес, «дополнительно» и отсутствие данных', () => {
    for (const [choice, key] of [
      ['auto', 'dns.auto'],
      ['tunnel', 'dns.tunnel'],
      ['doh', 'dns.doh'],
      ['dot', 'dns.dot'],
      ['local', 'dns.local'],
    ] as const) {
      expect(dnsLabel(dns({ mode: DnsSettings_Mode.SIMPLE, choice }), t)).toBe(t(key));
    }
    expect(dnsLabel(dns({ mode: DnsSettings_Mode.SIMPLE, choice: 'custom', remoteDns: 'https://dns.google/dns-query' }), t)).toBe('dns.google');
    expect(dnsLabel(dns({ mode: DnsSettings_Mode.ADVANCED }), t)).toBe(t('dns.adv'));
    expect(dnsLabel(dns({ mode: DnsSettings_Mode.SIMPLE }), t)).toBe(t('dns.auto'));
    expect(dnsLabel(null, t)).toBeNull();
  });

  it('хост из адреса: схема и путь убираются, порт не показывается, IPv6 в скобках', () => {
    expect(dnsHost('https://dns.google/dns-query')).toBe('dns.google');
    expect(dnsHost('tls://1.1.1.1:853')).toBe('1.1.1.1');
    expect(dnsHost('https://[2606:4700::1111]/dns-query')).toBe('2606:4700::1111');
    expect(dnsHost('8.8.8.8')).toBe('8.8.8.8');
    expect(dnsHost('  ')).toBe('');
  });
});
