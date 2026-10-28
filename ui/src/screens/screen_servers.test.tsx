// screen_servers.test.tsx — экран «Серверы»: тест задержки, меню, копирование ссылок.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { LatencyResultSchema, TestLatencyRequest_Mode } from '../gen/lavray_pb';
import type { LatencyResult } from '../gen/lavray_pb';
import { setLanguage } from '../lib/i18n';
import {
  buttonByText,
  click,
  flush,
  makeClients,
  mountWithCore,
  profileOf,
} from '../test-harness';
import { ServersScreen } from './screen_servers';

beforeEach(() => {
  setLanguage('en');
  window.localStorage.clear();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

const frame = (id: number, index: number, ms: number): LatencyResult =>
  create(LatencyResultSchema, { profileId: BigInt(id), index, total: 2, result: { latencyMs: ms } });

describe('T-22: подпись прогресса теста', () => {
  it('«Test all» показывает «Checked 1 of 2», а не шаблон с {done} и {total}', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const clients = makeClients({ profiles: [profileOf(1, 'S1'), profileOf(2, 'S2')] });
    vi.spyOn(clients.profiles, 'testLatency').mockImplementation(() =>
      (async function* (): AsyncGenerator<LatencyResult> {
        yield frame(1, 1, 40);
        await gate; // тест держит стрим открытым между кадрами
        yield frame(2, 2, 55);
      })(),
    );
    const m = await mountWithCore(clients, createElement(ServersScreen));

    await click(buttonByText(m.container, 'Test all'));
    await flush(20);
    const labels = Array.from(m.container.querySelectorAll('.prof-toolbar .cap.mono')).map(
      (e) => e.textContent ?? '',
    );
    expect(labels).toContain('Checked 1 of 2');
    expect(labels.join('|')).not.toMatch(/[{}]/);

    release();
    await flush(20);
    m.unmount();
  });
});

describe('T-24: меню режима теста без нереализованных режимов', () => {
  it('в меню ▾ только «Latency»; «Full test» скрыт, тест уходит как TCP-пинг', async () => {
    const clients = makeClients({ profiles: [profileOf(1, 'S1'), profileOf(2, 'S2')] });
    const testLatency = vi
      .spyOn(clients.profiles, 'testLatency')
      .mockImplementation(() =>
        (async function* (): AsyncGenerator<LatencyResult> {
          await Promise.resolve();
          yield frame(1, 1, 40);
        })(),
      );
    const m = await mountWithCore(clients, createElement(ServersScreen));

    await click(m.container.querySelector('button[aria-label="More tests"]'));
    const items = Array.from(m.container.querySelectorAll('[role="menuitem"]'));
    expect(items.map((i) => (i.textContent ?? '').trim())).toEqual(['Latency']);
    expect(m.container.textContent).not.toContain('Full test');

    await click(items[0]);
    expect(testLatency).toHaveBeenCalledTimes(1);
    expect(testLatency.mock.calls[0]?.[0]).toMatchObject({
      profileIds: [1n, 2n],
      mode: TestLatencyRequest_Mode.TCP_PING,
    });
    m.unmount();
  });
});
