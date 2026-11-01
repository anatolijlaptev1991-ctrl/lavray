// SPDX-License-Identifier: GPL-3.0-only

// useLogBuffer: предел строк журнала берётся из настройки ui.max_log_lines
// (хвосты A), а не зашит в экран.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import type { JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import {
  GetSettingsResponseSchema,
  LogLevel,
  LogLineSchema,
  SettingValueSchema,
  type LogLine,
} from '../../gen/lavray_pb';
import type { CoreClients } from '../../lib/core';
import {
  DEFAULT_MAX_LOG_LINES,
  MAX_LOG_LINES_KEY,
  MAX_MAX_LOG_LINES,
  MIN_MAX_LOG_LINES,
  appendBounded,
  clampMaxLines,
  trimTo,
  useLogBuffer,
} from './useLogBuffer';

describe('границы предела строк', () => {
  it('нет значения или не число — умолчание каталога', () => {
    expect(clampMaxLines(undefined)).toBe(DEFAULT_MAX_LOG_LINES);
    expect(clampMaxLines(Number.NaN)).toBe(DEFAULT_MAX_LOG_LINES);
    expect(clampMaxLines(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MAX_LOG_LINES);
  });

  it('значение зажимается в границы и округляется вниз', () => {
    expect(clampMaxLines(5)).toBe(MIN_MAX_LOG_LINES);
    expect(clampMaxLines(-3)).toBe(MIN_MAX_LOG_LINES);
    expect(clampMaxLines(1e9)).toBe(MAX_MAX_LOG_LINES);
    expect(clampMaxLines(250.9)).toBe(250);
    expect(clampMaxLines(MIN_MAX_LOG_LINES)).toBe(MIN_MAX_LOG_LINES);
    expect(clampMaxLines(MAX_MAX_LOG_LINES)).toBe(MAX_MAX_LOG_LINES);
  });

  it('trimTo и appendBounded оставляют самые новые и не меняют исходный список', () => {
    const src = [1, 2, 3, 4, 5];
    expect(trimTo(src, 3)).toEqual([3, 4, 5]);
    expect(trimTo(src, 10)).toEqual(src);
    expect(appendBounded(src, 6, 5)).toEqual([2, 3, 4, 5, 6]);
    expect(src).toEqual([1, 2, 3, 4, 5]);
  });
});

const line = (i: number): LogLine =>
  create(LogLineSchema, { tsMs: BigInt(1_700_000_000_000 + i), level: LogLevel.INFO, source: 'core', message: `m${String(i)}` });

/** Ядро: история из `count` строк, затем поток молчит; настройка — max (null — ошибка чтения). */
function makeCore(count: number, max: number | null): CoreClients {
  async function* feed(): AsyncGenerator<LogLine> {
    for (let i = 0; i < count; i += 1) yield line(i);
    await new Promise<void>(() => undefined);
  }
  const getSettings = vi.fn(() =>
    max === null
      ? Promise.reject(new Error('settings недоступны'))
      : Promise.resolve(
          create(GetSettingsResponseSchema, {
            values: { [MAX_LOG_LINES_KEY]: create(SettingValueSchema, { value: { case: 'intValue', value: BigInt(max) } }) },
          }),
        ),
  );
  return { logs: { subscribe: vi.fn(() => feed()) }, settings: { getSettings } } as unknown as CoreClients;
}

describe('useLogBuffer читает ui.max_log_lines', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  function Probe({ core }: { core: CoreClients }): JSX.Element {
    const { lines } = useLogBuffer(core, 200);
    const first = lines[0]?.message ?? '';
    const last = lines[lines.length - 1]?.message ?? '';
    return createElement('output', null, `${String(lines.length)}|${first}|${last}`);
  }

  async function shown(core: CoreClients): Promise<string> {
    act(() => {
      root.render(createElement(Probe, { core }));
    });
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      });
    }
    return host.querySelector('output')?.textContent ?? '';
  }

  it('держит не больше строк, чем в настройке, и оставляет самые новые', async () => {
    expect(await shown(makeCore(150, 100))).toBe('100|m50|m149');
  });

  it('настройка недоступна — действует умолчание', async () => {
    expect(await shown(makeCore(DEFAULT_MAX_LOG_LINES + 20, null))).toBe(
      `${String(DEFAULT_MAX_LOG_LINES)}|m20|m${String(DEFAULT_MAX_LOG_LINES + 19)}`,
    );
  });

  it('предел ниже минимума поднимается до минимума', async () => {
    expect(await shown(makeCore(150, 5))).toBe('100|m50|m149');
  });
});
