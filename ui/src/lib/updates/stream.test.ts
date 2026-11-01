// SPDX-License-Identifier: GPL-3.0-only

// stream.test.ts — чтение серверных стримов обновлений (T-75, класс X): отмена
// пользователем, зависание источника (нет событий дольше порога), обычное
// завершение и ошибка стрима. Зависший стрим не должен держать экран в
// «загрузке» вечно.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStream } from './stream';

/** Бесконечно ждёт, пока не оборвут signal; потом бросает AbortError, как fetch. */
function hanging(signal: AbortSignal): AsyncIterable<number> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<number> {
      return {
        next: () =>
          new Promise<IteratorResult<number>>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }),
      };
    },
  };
}

async function* events(values: readonly number[]): AsyncGenerator<number> {
  await Promise.resolve();
  for (const v of values) yield v;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('readStream', () => {
  it('передаёт события по порядку и заканчивается done', async () => {
    const seen: number[] = [];
    const end = await readStream(() => events([1, 2, 3]), (v) => seen.push(v), {
      signal: new AbortController().signal,
      idleMs: 1000,
    });
    expect(end).toBe('done');
    expect(seen).toEqual([1, 2, 3]);
  });

  it('пустой стрим — done без событий', async () => {
    const seen: number[] = [];
    const end = await readStream(() => events([]), (v) => seen.push(v), {
      signal: new AbortController().signal,
      idleMs: 1000,
    });
    expect(end).toBe('done');
    expect(seen).toEqual([]);
  });

  it('отмена пользователем обрывает чтение: cancelled, без исключения', async () => {
    const user = new AbortController();
    const pending = readStream(hanging, () => undefined, { signal: user.signal, idleMs: 60_000 });
    user.abort();
    await expect(pending).resolves.toBe('cancelled');
  });

  it('уже отменённый signal — cancelled без открытия стрима', async () => {
    const user = new AbortController();
    user.abort();
    const open = vi.fn(hanging);
    await expect(readStream(open, () => undefined, { signal: user.signal, idleMs: 1000 })).resolves.toBe('cancelled');
    expect(open).not.toHaveBeenCalled();
  });

  it('нет событий дольше порога — stalled, стрим оборван', async () => {
    const aborted = vi.fn();
    const open = (signal: AbortSignal): AsyncIterable<number> => {
      signal.addEventListener('abort', aborted);
      return hanging(signal);
    };
    const pending = readStream(open, () => undefined, { signal: new AbortController().signal, idleMs: 5000 });
    await vi.advanceTimersByTimeAsync(4999);
    expect(aborted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    await expect(pending).resolves.toBe('stalled');
    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it('каждое событие продлевает ожидание: стрим с редкими событиями не считается зависшим', async () => {
    async function* slow(): AsyncGenerator<number> {
      for (let i = 0; i < 3; i += 1) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 4000);
        });
        yield i;
      }
    }
    const seen: number[] = [];
    const pending = readStream(() => slow(), (v) => seen.push(v), {
      signal: new AbortController().signal,
      idleMs: 5000,
    });
    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(pending).resolves.toBe('done');
    expect(seen).toEqual([0, 1, 2]);
  });

  it('ошибка стрима (не отмена) пробрасывается', async () => {
    async function* broken(): AsyncGenerator<number> {
      await Promise.resolve();
      yield 1;
      throw new Error('boom');
    }
    const seen: number[] = [];
    await expect(
      readStream(() => broken(), (v) => seen.push(v), { signal: new AbortController().signal, idleMs: 1000 }),
    ).rejects.toThrow('boom');
    expect(seen).toEqual([1]);
  });

  it('после завершения таймер не остаётся (нет ложного stalled позже)', async () => {
    await readStream(() => events([1]), () => undefined, { signal: new AbortController().signal, idleMs: 100 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
