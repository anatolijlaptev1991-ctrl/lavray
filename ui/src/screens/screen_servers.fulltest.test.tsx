// SPDX-License-Identifier: GPL-3.0-only

// screen_servers.fulltest.test.tsx — T-84: пункты «URL-тест» и «Полный тест»
// в меню ▾, диалог опций, отчёт полного теста в колонке результата.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { LatencyResultSchema, TestLatencyRequest_Mode, TestResultSchema } from '../gen/lavray_pb';
import type { LatencyResult, Profile } from '../gen/lavray_pb';
import { setLanguage } from '../lib/i18n';
import { buttonByText, click, flush, makeClients, mountWithCore, profileOf } from '../test-harness';
import type { Mounted } from '../test-harness';
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

/** Отчёт: 120 мс, UDP 45 мс, 25,6 Мбит/с = 3,2 МБ/с, вход и выход. */
const REPORT = {
  latencyMs: 120,
  udpLatencyMs: 45,
  downloadBps: 25_600_000,
  ingressIp: '203.0.113.5',
  egressIp: '198.51.100.7',
};

const fullFrame = (id: number, index: number, total: number): LatencyResult =>
  create(LatencyResultSchema, {
    profileId: BigInt(id),
    index,
    total,
    result: { latencyMs: 120, fullReport: REPORT },
  });

/** Текст без неразрывных пробелов, которыми i18n отделяет единицы. */
const plain = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s/g, ' ');

function stream(frames: LatencyResult[]): () => AsyncGenerator<LatencyResult> {
  return async function* (): AsyncGenerator<LatencyResult> {
    await Promise.resolve();
    for (const f of frames) yield f;
  };
}

async function mountServers(profiles: Profile[]): Promise<{ clients: CoreClients; m: Mounted }> {
  const clients = makeClients({ profiles });
  const m = await mountWithCore(clients, createElement(ServersScreen));
  return { clients, m };
}

async function openMenu(m: Mounted): Promise<Element[]> {
  await click(m.container.querySelector('button[aria-label="More tests"]'));
  return Array.from(document.body.querySelectorAll('[role="menuitem"]'));
}

const dialog = (): HTMLElement => {
  const d = document.body.querySelector<HTMLElement>('[role="dialog"]');
  if (d === null) throw new Error('диалог не открыт');
  return d;
};

const checkboxes = (): HTMLInputElement[] =>
  Array.from(dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));

describe('T-84: меню режима теста', () => {
  it('url_test_menu_item_calls_url_mode', async () => {
    const { clients, m } = await mountServers([profileOf(1, 'S1'), profileOf(2, 'S2')]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const testLatency = vi.spyOn(clients.profiles, 'testLatency').mockImplementation(() =>
      (async function* (): AsyncGenerator<LatencyResult> {
        yield create(LatencyResultSchema, { profileId: 1n, index: 1, total: 2, result: { latencyMs: 77 } });
        await gate;
      })(),
    );

    const items = await openMenu(m);
    expect(items.map((i) => (i.textContent ?? '').trim())).toEqual(['Latency', 'URL test', 'Full test']);

    await click(items[1]);
    await flush(20);
    expect(testLatency).toHaveBeenCalledTimes(1);
    expect(testLatency.mock.calls[0]?.[0]).toMatchObject({
      profileIds: [1n, 2n],
      mode: TestLatencyRequest_Mode.URL_TEST,
    });
    // Прогресс «Проверено i из N» и результат кадра.
    const progress = Array.from(m.container.querySelectorAll('.prof-toolbar .cap.mono')).map((e) => e.textContent);
    expect(progress).toContain('Checked 1 of 2');
    const lat = Array.from(m.container.querySelectorAll('.prow')).map((r) => r.querySelector('.prow-lat')?.textContent);
    expect(lat[0]).toContain('77');

    release();
    await flush(20);
    m.unmount();
  });

  it('пункт «Latency» по-прежнему шлёт TCP-пинг', async () => {
    const { clients, m } = await mountServers([profileOf(1, 'S1')]);
    const testLatency = vi.spyOn(clients.profiles, 'testLatency').mockImplementation(stream([]));
    const items = await openMenu(m);
    await click(items[0]);
    expect(testLatency.mock.calls[0]?.[0]).toMatchObject({ mode: TestLatencyRequest_Mode.TCP_PING });
    m.unmount();
  });
});

describe('T-84: диалог опций полного теста', () => {
  it('full_test_dialog_requires_one_option', async () => {
    const { clients, m } = await mountServers([profileOf(1, 'S1'), profileOf(2, 'S2')]);
    const testLatency = vi.spyOn(clients.profiles, 'testLatency').mockImplementation(stream([]));

    const items = await openMenu(m);
    await click(items[2]);
    // задержка, UDP, скорость, IP: скорость выкачивает файл, поэтому не отмечена
    expect(checkboxes().map((b) => b.checked)).toEqual([true, true, false, true]);
    expect(buttonByText(dialog(), 'Start').disabled).toBe(false);

    // Снимаем всё: запуск закрыт, причина названа.
    for (const b of checkboxes().filter((x) => x.checked)) await click(b);
    expect(buttonByText(dialog(), 'Start').disabled).toBe(true);
    expect(dialog().textContent).toContain('Choose at least one check.');
    await click(buttonByText(dialog(), 'Start'));
    expect(testLatency).not.toHaveBeenCalled();

    // Одна галочка — снова можно; уходит ровно она.
    await click(checkboxes()[1]);
    expect(buttonByText(dialog(), 'Start').disabled).toBe(false);
    await click(buttonByText(dialog(), 'Start'));
    await flush(20);

    expect(testLatency).toHaveBeenCalledTimes(1);
    expect(testLatency.mock.calls[0]?.[0]).toMatchObject({
      profileIds: [1n, 2n],
      mode: TestLatencyRequest_Mode.FULL_TEST,
      fullLatency: false,
      fullUdpLatency: true,
      fullSpeed: false,
      fullInOutIp: false,
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    m.unmount();
  });

  it('«Cancel» закрывает диалог без запроса', async () => {
    const { clients, m } = await mountServers([profileOf(1, 'S1')]);
    const testLatency = vi.spyOn(clients.profiles, 'testLatency').mockImplementation(stream([]));
    const items = await openMenu(m);
    await click(items[2]);
    await click(buttonByText(dialog(), 'Cancel'));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(testLatency).not.toHaveBeenCalled();
    m.unmount();
  });
});

describe('T-84: отчёт полного теста в колонке результата', () => {
  it('full_report_is_shown_in_result_column', async () => {
    // Сохранённый в профиле отчёт виден сразу после открытия экрана.
    const saved = profileOf(1, 'Saved');
    saved.testResult = create(TestResultSchema, { latencyMs: 120, fullReport: REPORT });
    const { m } = await mountServers([saved]);
    const col = m.container.querySelector('.prow .prow-res');
    expect(plain(col)).toContain('Latency: 120 ms');
    expect(plain(col)).toContain('UDP: 45 ms');
    expect(plain(col)).toContain('Speed: 3.2 MB/s');
    expect(plain(col)).toContain('In: 203.0.113.5');
    expect(plain(col)).toContain('Out: 198.51.100.7');
    m.unmount();
  });

  it('отчёт приходит кадром стрима и остаётся после обновления списка', async () => {
    const { clients, m } = await mountServers([profileOf(1, 'S1'), profileOf(2, 'S2')]);
    vi.spyOn(clients.profiles, 'testLatency').mockImplementation(stream([fullFrame(2, 1, 1)]));
    const items = await openMenu(m);
    await click(items[2]);
    await click(buttonByText(dialog(), 'Start'));
    await flush(40);

    const rows = Array.from(m.container.querySelectorAll('.prow'));
    expect(plain(rows[1]?.querySelector('.prow-res'))).toContain('Out: 198.51.100.7');
    expect(rows[0]?.querySelector('.prow-rep')).toBeNull(); // у непроверенного отчёта нет
    m.unmount();
  });

  it('частичный отказ: ошибка замера стоит в конце строки отчёта', async () => {
    const p = profileOf(1, 'S1');
    p.testResult = create(TestResultSchema, {
      latencyMs: 90,
      fullReport: { latencyMs: 90, error: 'speed: server answered 403' },
    });
    const { m } = await mountServers([p]);
    expect(plain(m.container.querySelector('.prow-rep'))).toBe('Latency: 90 ms; speed: server answered 403');
    m.unmount();
  });
});
