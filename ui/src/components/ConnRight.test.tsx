// ConnRight.test.tsx — карточки «Проверка утечек» и «Качество связи» (T-36):
// неизмеренное — «не проверено»/«—», измеренное — из CheckLeaks ядра.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { setLanguage } from '../lib/i18n';
import { mount, stubCore, unmountAll } from '../test-utils/coreStub';
import type { Json } from '../test-utils/coreStub';
import { ConnRight } from './ConnRight';

beforeEach(() => {
  setLanguage('en');
});

afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
});

async function render(
  report: Json,
  props: { connected?: boolean; latencyMs?: number } = {},
): Promise<{ rows: string[]; health: string[]; leakCalls: number }> {
  const core = stubCore({ 'DiagnosticsService/CheckLeaks': report });
  const view = await mount(
    createElement(ConnRight, {
      connected: props.connected ?? true,
      latencyMs: props.latencyMs,
      presetName: 'Global',
      presetRules: 2,
    }),
  );
  const text = (el: Element, sel: string): string => el.querySelector(sel)?.textContent ?? '';
  const rows = Array.from(view.container.querySelectorAll('#leakCard .leak-row')).map((li) => {
    const kind = /lk-(ok|warn|info)/.exec(li.querySelector('.lk-st')?.className ?? '')?.[1] ?? '?';
    return `${text(li, '.lk-k')}=${text(li, '.lk-v')}[${kind}]`;
  });
  const health = Array.from(view.container.querySelectorAll('#healthCard .hl-cell')).map(
    (c) => `${text(c, '.cap')}=${text(c, '.val')}`,
  );
  return { rows, health, leakCalls: core.bodies('DiagnosticsService/CheckLeaks').length };
}

describe('карточка «Проверка утечек»', () => {
  it('ядро отдаёт только прямой IP (как сейчас): все строки «not checked», ни одного «ок»', async () => {
    const { rows } = await render({ directIp: '203.0.113.7', tunnelActive: true });

    expect(rows).toEqual([
      'IP via tunnel=not checked[info]',
      'Direct IP=not checked[info]',
      'DNS=not checked[info]',
      'IPv6=not checked[info]',
    ]);
  });

  it('полный отчёт: IP отличаются — «ок» по IP, прямой IP скрыт, DNS и IPv6 из ответа', async () => {
    const { rows } = await render({
      tunnelIp: '198.51.100.9',
      directIp: '203.0.113.7',
      dnsEgress: '198.51.100.1',
      ipv6DirectAvailable: false,
      tunnelActive: true,
    });

    expect(rows).toEqual([
      'IP via tunnel=198.51.100.9[ok]',
      'Direct IP=hidden[ok]',
      'DNS=198.51.100.1[info]',
      'IPv6=no leaks[ok]',
    ]);
  });

  it('IP через туннель совпал с прямым — предупреждение; IPv6 доступен напрямую — предупреждение', async () => {
    const { rows } = await render({
      tunnelIp: '203.0.113.7',
      directIp: '203.0.113.7',
      ipv6DirectAvailable: true,
      tunnelActive: true,
    });

    expect(rows).toEqual([
      'IP via tunnel=203.0.113.7[warn]',
      'Direct IP=203.0.113.7[warn]',
      'DNS=not checked[info]',
      'IPv6=reachable directly[warn]',
    ]);
  });

  it('без подключения проверка не запускается', async () => {
    const { rows, leakCalls } = await render({}, { connected: false });

    expect(rows).toEqual([]);
    expect(leakCalls).toBe(0);
  });
});

describe('карточка «Качество связи»', () => {
  it('потери и DNS не измеряются: «—», без зашитых «0 %» и «12 ms»', async () => {
    const { health } = await render({}, { latencyMs: 43 });

    expect(health.slice(0, 3)).toEqual(['Latency=43 ms', 'Packet loss=—', 'DNS resolution=—']);
    expect(health.join('|')).not.toMatch(/0 %|12/);
  });

  it('задержка 0 (не измерялась), отрицательная (недоступен) и неизвестная — «—»', async () => {
    for (const latencyMs of [0, -1, undefined]) {
      const { health } = await render({}, latencyMs === undefined ? {} : { latencyMs });
      expect(health[0], String(latencyMs)).toBe('Latency=—');
      unmountAll();
    }
  });
});
