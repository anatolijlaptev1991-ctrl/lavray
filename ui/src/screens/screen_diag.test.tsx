// screen_diag.test.tsx — экран «Проверки»: 8 проверок, «не проверено», честная сводка (T-32).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { RunSelfCheckRequest_CheckKind as K, SelfCheckResult_Status as S } from '../gen/lavray_pb';
import { CoreContext } from '../hooks/useCore';
import type { CoreClients } from '../lib/core';
import { setLanguage } from '../lib/i18n';
import { DiagScreen } from './screen_diag';

interface R {
  kind: number;
  status: number;
  fixCode: string;
  detail?: string;
}
const r = (kind: number, status: number, detail = '', fixCode = ''): R => ({ kind, status, fixCode, detail });

const KINDS = [
  K.CORE_ALIVE,
  K.SERVER_REACHABLE,
  K.DNS_RESOLVES,
  K.PROXY_ACTIVE,
  K.CLOCK_SKEW,
  K.SUBSCRIPTION_OK,
  K.PORT_FREE,
  K.IPV6,
];

describe('DiagScreen: проверки', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
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
    vi.useRealTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function show(results: R[]): Promise<void> {
    const clients = {
      diagnostics: { runSelfCheck: vi.fn().mockResolvedValue({ results }) },
    } as unknown as CoreClients;
    act(() => {
      root?.render(createElement(CoreContext.Provider, { value: clients }, createElement(DiagScreen)));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000); // анимация: по 220 мс на строку
    });
  }

  const titles = (): string[] => Array.from(container.querySelectorAll('.chk-t')).map((e) => e.textContent ?? '');
  const summary = (): string => container.querySelector('[role="status"]')?.textContent ?? '';

  it('показывает 8 проверок с их названиями, а не подписями действий', async () => {
    await show([
      r(K.CORE_ALIVE, S.OK, '0.1.0'),
      r(K.SERVER_REACHABLE, S.UNSPECIFIED, 'no_connection'),
      r(K.DNS_RESOLVES, S.UNSPECIFIED, 'no_connection'),
      r(K.PROXY_ACTIVE, S.FAIL, 'no_connection'),
      r(K.CLOCK_SKEW, S.OK, '+0.3 s'),
      r(K.SUBSCRIPTION_OK, S.UNSPECIFIED, 'no_subscription'),
      r(K.PORT_FREE, S.OK, '127.0.0.1:2080'),
      r(K.IPV6, S.UNSPECIFIED, 'no_connection'),
    ]);
    expect(titles()).toHaveLength(8);
    expect(titles()[4]).toBe('Computer clock'); // раньше — «Sync the clock» (подпись кнопки)
    expect(titles()[5]).toBe('Subscription is active');
    expect(titles()[7]).toContain('IPv6');
  });

  it('непроверенное помечено «не проверено» и объяснено; сводка не говорит «проблем нет»', async () => {
    await show([
      r(K.CORE_ALIVE, S.OK, '0.1.0'),
      r(K.SERVER_REACHABLE, S.UNSPECIFIED, 'no_connection'),
      r(K.DNS_RESOLVES, S.UNSPECIFIED, 'no_connection'),
      r(K.PROXY_ACTIVE, S.OK),
      r(K.CLOCK_SKEW, S.OK, '+0.3 s'),
      r(K.SUBSCRIPTION_OK, S.UNSPECIFIED, 'no_subscription'),
      r(K.PORT_FREE, S.OK, '127.0.0.1:2080'),
      r(K.IPV6, S.OK),
    ]);
    const rows = Array.from(container.querySelectorAll('.chk-item'));
    expect(rows[1]?.textContent).toContain('not checked');
    expect(rows[1]?.textContent).toContain('No active connection');
    expect(rows[5]?.textContent).toContain('No subscriptions');
    expect(summary()).toBe('No problems found, but 3 of 8 not checked');
  });

  it('считает проблемы только среди выполненных; «Проблем не найдено» — когда проверено всё', async () => {
    await show(KINDS.map((k) => r(k, k === K.PORT_FREE ? S.FAIL : S.UNSPECIFIED, 'no_connection', 'change_port')));
    expect(summary()).toBe('Problems found: 1');
    await show(KINDS.map((k) => r(k, S.OK)));
    expect(summary()).toBe('No problems found');
  });
});
