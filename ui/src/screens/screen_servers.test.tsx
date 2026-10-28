// screen_servers.test.tsx — экран «Серверы»: тест задержки, меню, копирование ссылок.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { ExportLinksResponseSchema, LatencyResultSchema, TestLatencyRequest_Mode } from '../gen/lavray_pb';
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
import type { CoreClients } from '../lib/core';
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

describe('T-25: «Копировать ссылку»', () => {
  const writeText = vi.fn((_text: string) => Promise.resolve());
  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  async function mountServers(links: string[]): Promise<{
    container: HTMLElement;
    exportLinks: MockInstance<CoreClients['profiles']['exportLinks']>;
    unmount: () => void;
  }> {
    const clients = makeClients({ profiles: [profileOf(1, 'S1'), profileOf(2, 'S2')] });
    const exportLinks = vi
      .spyOn(clients.profiles, 'exportLinks')
      .mockResolvedValue(create(ExportLinksResponseSchema, { links }));
    const m = await mountWithCore(clients, createElement(ServersScreen));
    return { container: m.container, exportLinks, unmount: m.unmount };
  }

  const toolbarCopy = (c: HTMLElement): HTMLButtonElement => {
    const bar = c.querySelector<HTMLElement>('.srv-actions');
    if (bar === null) throw new Error('панель действий не найдена');
    return buttonByText(bar, 'Copy link');
  };

  it('без выделения копирует ссылки видимых серверов, а не пустой запрос', async () => {
    const t = await mountServers(['vless://a', 'vless://b']);
    await click(toolbarCopy(t.container));
    expect(t.exportLinks).toHaveBeenCalledWith({ ids: [1n, 2n] });
    expect(writeText).toHaveBeenCalledWith('vless://a\nvless://b');
    expect(t.container.querySelector('.toast-ok')?.textContent).toBe('Link copied to clipboard');
    t.unmount();
  });

  it('с выделением копирует только выделенные', async () => {
    const t = await mountServers(['vless://b']);
    await click(t.container.querySelector('input[aria-label="Select S2"]'));
    await click(toolbarCopy(t.container));
    expect(t.exportLinks).toHaveBeenCalledWith({ ids: [2n] });
    t.unmount();
  });

  it('пункт меню строки копирует ссылку своей строки, даже если отмечены другие', async () => {
    const t = await mountServers(['vless://b']);
    await click(t.container.querySelector('input[aria-label="Select S1"]'));
    const moreButtons = t.container.querySelectorAll('.prow-more');
    await click(moreButtons[1]); // меню строки S2
    const menu = t.container.querySelector<HTMLElement>('[role="menu"]');
    if (menu === null) throw new Error('меню строки не открылось');
    await click(buttonByText(menu, 'Copy link'));
    expect(t.exportLinks).toHaveBeenCalledWith({ ids: [2n] });
    expect(writeText).toHaveBeenCalledWith('vless://b');
    t.unmount();
  });

  it('если у серверов нет ссылки (цепочка, custom), буфер не трогаем и показываем ошибку', async () => {
    const t = await mountServers([]);
    await click(toolbarCopy(t.container));
    expect(writeText).not.toHaveBeenCalled();
    expect(t.container.querySelector('[role="alert"]')?.textContent).toContain('no shareable link');
    t.unmount();
  });
});
