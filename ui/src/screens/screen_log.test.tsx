// screen_log.test.tsx — регрессия T-70: экран «Журнал» берёт историю и новые
// строки из одного потока (без дублей GetTail + Subscribe), уровень фильтрует
// и уже загруженные строки, «Пауза/Продолжить» как в прототипе, плейсхолдер
// поиска — log.searchPh.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import { CoreContext } from '../hooks/useCore';
import type { CoreClients } from '../lib/core';
import { setLanguage } from '../lib/i18n';
import { GetTailResponseSchema, LogLevel, LogLineSchema, type LogLine } from '../gen/lavray_pb';
import { LogScreen } from './screen_log';

const line = (message: string, level: LogLevel, i: number): LogLine =>
  create(LogLineSchema, { tsMs: BigInt(1_700_000_000_000 + i * 1000), level, source: 'core', message });

const HISTORY = [line('m-info', LogLevel.INFO, 0), line('m-warn', LogLevel.WARN, 1), line('m-error', LogLevel.ERROR, 2)];

/** Ядро: Subscribe сначала повторяет историю (как реальное), затем отдаёт push()-строки. */
function makeCore(): {
  core: CoreClients;
  push: (l: LogLine) => void;
  subscribe: ReturnType<typeof vi.fn>;
  getTail: ReturnType<typeof vi.fn>;
} {
  const queue: LogLine[] = [...HISTORY];
  let wake: (() => void) | undefined;
  async function* feed(): AsyncGenerator<LogLine> {
    for (;;) {
      const next = queue.shift();
      if (next !== undefined) yield next;
      else
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
    }
  }
  const subscribe = vi.fn(() => feed());
  const getTail = vi.fn(() => Promise.resolve(create(GetTailResponseSchema, { lines: HISTORY })));
  const push = (l: LogLine): void => {
    queue.push(l);
    wake?.();
  };
  return { core: { logs: { subscribe, getTail } } as unknown as CoreClients, push, subscribe, getTail };
}

describe('экран «Журнал» (T-70)', () => {
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
  const messages = (): string[] =>
    Array.from(document.querySelectorAll('#logView .log-l')).map((r) => r.lastElementChild?.textContent ?? '');
  const pauseBtn = (): HTMLButtonElement | undefined =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('.log-head button')).find((b) =>
      ['Пауза', 'Продолжить'].includes(b.textContent ?? ''),
    );
  function pickLevel(level: LogLevel): void {
    act(() => {
      const sel = document.querySelector<HTMLSelectElement>('select.select')!;
      sel.value = String(level);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  async function mount(): Promise<ReturnType<typeof makeCore>> {
    const fake = makeCore();
    act(() => {
      root.render(createElement(CoreContext.Provider, { value: fake.core }, createElement(LogScreen)));
    });
    await settle();
    return fake;
  }

  it('история и новые строки идут одним потоком, без дублей и без GetTail', async () => {
    const { push, subscribe, getTail } = await mount();
    expect(messages()).toEqual(['m-info', 'm-warn', 'm-error']);
    expect(getTail).not.toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0]?.[0]).toMatchObject({ tailLines: 200 });
    push(line('live', LogLevel.INFO, 3));
    await settle();
    expect(messages()).toEqual(['m-info', 'm-warn', 'm-error', 'live']);
  });

  it('уровень фильтрует и уже загруженные строки, не переподписываясь', async () => {
    const { subscribe } = await mount();
    pickLevel(LogLevel.ERROR);
    expect(messages()).toEqual(['m-error']);
    pickLevel(LogLevel.WARN);
    expect(messages()).toEqual(['m-warn', 'm-error']);
    pickLevel(LogLevel.INFO);
    expect(messages()).toEqual(['m-info', 'm-warn', 'm-error']);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('«Пауза» замораживает список, «Продолжить» показывает накопленное; поиск подписан log.searchPh', async () => {
    const { push } = await mount();
    expect(document.querySelector<HTMLInputElement>('.log-toolbar input.input')?.placeholder).toBe('Поиск в журнале…');
    act(() => {
      pauseBtn()?.click();
    });
    expect(pauseBtn()?.textContent).toBe('Продолжить');
    push(line('after-pause', LogLevel.INFO, 4));
    await settle();
    expect(messages()).toEqual(['m-info', 'm-warn', 'm-error']);
    act(() => {
      pauseBtn()?.click();
    });
    expect(pauseBtn()?.textContent).toBe('Пауза');
    expect(messages()).toEqual(['m-info', 'm-warn', 'm-error', 'after-pause']);
  });
});
