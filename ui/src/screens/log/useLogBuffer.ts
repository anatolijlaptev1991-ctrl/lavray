// SPDX-License-Identifier: GPL-3.0-only

// useLogBuffer.ts — буфер строк экрана «Журнал»: один поток SubscribeLogs
// (история + новые строки) и предел числа строк из настройки ui.max_log_lines.
import { useEffect, useRef, useState } from 'react';
import type { LogLine } from '../../gen/lavray_pb';
import { friendlyCoreError, type CoreClients } from '../../lib/core';

/** Настройка ядра: сколько строк журнала держит экран. */
export const MAX_LOG_LINES_KEY = 'ui.max_log_lines';
/** Умолчание каталога настроек (model.SettingDescriptors). */
export const DEFAULT_MAX_LOG_LINES = 1000;
/** Границы: меньше — журнал бесполезен, больше — тормозит список. */
export const MIN_MAX_LOG_LINES = 100;
export const MAX_MAX_LOG_LINES = 50_000;

/** Предел из настройки: нет числа — умолчание, иначе в границах. */
export function clampMaxLines(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_LOG_LINES;
  return Math.min(MAX_MAX_LOG_LINES, Math.max(MIN_MAX_LOG_LINES, Math.trunc(value)));
}

/** Список без старейших строк сверх предела (исходный не меняется). */
export function trimTo<T>(list: readonly T[], max: number): T[] {
  return list.length > max ? list.slice(list.length - max) : [...list];
}

/** Строка в конец списка, затем обрезка до предела. */
export function appendBounded<T>(list: readonly T[], item: T, max: number): T[] {
  return trimTo([...list, item], max);
}

/** Не чаще раза за это время снимок уходит в React (пачка строк — один коммит). */
export const LOG_FLUSH_MS = 50;

/**
 * Изменяемое кольцо строк: push — O(1) амортизированно, лишнее срезается
 * пачкой, когда буфер вдвое больше предела. Снимок — ровно последние `max`.
 */
export interface LogRing {
  readonly push: (line: LogLine, max: number) => void;
  readonly snapshot: (max: number) => LogLine[];
  readonly clear: () => void;
}

export function createLogRing(): LogRing {
  let items: LogLine[] = [];
  return {
    push: (line, max): void => {
      items.push(line);
      if (items.length > max * 2) items = items.slice(items.length - max);
    },
    snapshot: (max) => trimTo(items, max),
    clear: (): void => {
      items = [];
    },
  };
}

export interface LogBuffer {
  readonly lines: readonly LogLine[];
  /** Текст ошибки потока; пусто — потока не прерывало. */
  readonly streamErr: string;
}

/**
 * Подписывается на журнал и копит строки не больше ui.max_log_lines. Подписка
 * не ждёт настройку: пока она читается, действует умолчание, потом буфер
 * обрезается до прочитанного предела. Настройка недоступна — умолчание остаётся.
 */
export function useLogBuffer(core: CoreClients, tailLines: number): LogBuffer {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [streamErr, setStreamErr] = useState('');
  const maxRef = useRef(DEFAULT_MAX_LOG_LINES);
  const ringRef = useRef<LogRing>(createLogRing());

  useEffect(() => {
    const abort = new AbortController();
    void (async (): Promise<void> => {
      try {
        const res = await core.settings.getSettings({ keys: [MAX_LOG_LINES_KEY] }, { signal: abort.signal });
        const v = res.values[MAX_LOG_LINES_KEY]?.value;
        if (abort.signal.aborted) return;
        maxRef.current = clampMaxLines(v?.case === 'intValue' ? Number(v.value) : undefined);
        setLines((prev) => trimTo(prev, maxRef.current));
      } catch {
        /* настройка недоступна: действует умолчание */
      }
    })();
    return (): void => {
      abort.abort();
    };
  }, [core]);

  // T-70: один источник строк. Подписка сама отдаёт историю (tail_lines) и затем
  // новые строки одним упорядоченным потоком — отдельный GetTail давал дубли.
  // Строки копятся в изменяемом кольце, а в React уходит снимок не чаще LOG_FLUSH_MS.
  useEffect(() => {
    const abort = new AbortController();
    const ring = ringRef.current;
    ring.clear();
    setLines([]);
    setStreamErr('');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastFlush = 0;
    const flush = (): void => {
      timer = undefined;
      lastFlush = Date.now();
      setLines(ring.snapshot(maxRef.current));
    };
    const onLine = (line: LogLine): void => {
      ring.push(line, maxRef.current);
      if (timer !== undefined) return;
      timer = setTimeout(flush, Math.max(0, LOG_FLUSH_MS - (Date.now() - lastFlush)));
    };
    void (async (): Promise<void> => {
      try {
        const stream = core.logs.subscribe({ tailLines }, { signal: abort.signal });
        for await (const line of stream) {
          if (abort.signal.aborted) return;
          onLine(line);
        }
      } catch (e) {
        if (!abort.signal.aborted) setStreamErr(friendlyCoreError(e));
      }
    })();
    return (): void => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [core, tailLines]);

  return { lines, streamErr };
}
