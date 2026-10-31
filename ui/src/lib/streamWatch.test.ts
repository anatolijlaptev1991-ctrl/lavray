// SPDX-License-Identifier: GPL-3.0-only

// streamWatch.test.ts — переподключение потока с нарастающей паузой (T-79).
// Время фейковое: паузы проверяются точно.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKOFF_CAP_MS, BACKOFF_START_MS, nextBackoff, watchWithBackoff } from './streamWatch';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Поток из готовых кадров; в конце — ошибка (если задана) либо чистый конец. */
function stream(items: readonly number[], error?: Error): AsyncIterable<number> {
  return {
    [Symbol.asyncIterator]: (): AsyncIterator<number> => {
      let i = 0;
      return {
        next: (): Promise<IteratorResult<number>> => {
          const item = items[i];
          if (item !== undefined) {
            i += 1;
            return Promise.resolve({ value: item, done: false });
          }
          return error === undefined ? Promise.resolve({ value: undefined, done: true }) : Promise.reject(error);
        },
      };
    },
  };
}

/** Поток, который сразу падает; считаем открытия. */
function failing(opens: number[]): (signal: AbortSignal) => AsyncIterable<number> {
  return () => {
    opens.push(Date.now());
    return stream([], new Error('boom'));
  };
}

describe('watchWithBackoff', () => {
  it('паузы между попытками: 1, 2, 4, 8, 16, 30, 30 секунд', () => {
    expect([1000, 2000, 4000, 8000, 16000, 30000].map((ms) => nextBackoff(ms))).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000,
    ]);
    expect(BACKOFF_START_MS).toBe(1000);
    expect(BACKOFF_CAP_MS).toBe(30000);
  });

  it('при сбое открывает поток заново с растущей паузой и сообщает об ошибке', async () => {
    const opens: number[] = [];
    const errors: unknown[] = [];
    const ac = new AbortController();
    const t0 = Date.now();
    void watchWithBackoff(failing(opens), { onFrame: () => undefined, onError: (e) => errors.push(e) }, ac.signal);

    await vi.advanceTimersByTimeAsync(0);
    expect(opens).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(opens).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(opens).toHaveLength(2); // через 1 с
    await vi.advanceTimersByTimeAsync(2000);
    expect(opens).toHaveLength(3); // ещё через 2 с
    await vi.advanceTimersByTimeAsync(4000);
    expect(opens).toHaveLength(4); // ещё через 4 с
    expect(opens.map((at) => at - t0)).toEqual([0, 1000, 3000, 7000]);
    expect(errors).toHaveLength(4);
    ac.abort();
  });

  it('потолок паузы — 30 секунд', async () => {
    const opens: number[] = [];
    const ac = new AbortController();
    void watchWithBackoff(failing(opens), { onFrame: () => undefined, onError: () => undefined }, ac.signal);
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000 + 8000 + 16000); // 5 попыток позади, 6-я сейчас
    expect(opens).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(opens).toHaveLength(7);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(opens).toHaveLength(8); // и дальше те же 30 с
    ac.abort();
  });

  it('полученный кадр возвращает паузу к 1 секунде', async () => {
    let call = 0;
    const times: number[] = [];
    const open = (): AsyncIterable<number> => {
      call += 1;
      times.push(Date.now());
      return stream(call === 3 ? [42] : [], new Error('boom')); // третье открытие успевает отдать кадр
    };
    const frames: number[] = [];
    const ac = new AbortController();
    const t0 = Date.now();
    void watchWithBackoff(open, { onFrame: (f) => frames.push(f), onError: () => undefined }, ac.signal);
    await vi.advanceTimersByTimeAsync(1000); // 2-е открытие
    await vi.advanceTimersByTimeAsync(2000); // 3-е открытие: кадр, обрыв, пауза снова 1 с
    await vi.advanceTimersByTimeAsync(1000); // 4-е открытие
    expect(frames).toEqual([42]);
    expect(times.map((at) => at - t0)).toEqual([0, 1000, 3000, 4000]);
    ac.abort();
  });

  it('чистый конец потока тоже ведёт к переподключению, без ошибки', async () => {
    const opens: number[] = [];
    const errors: unknown[] = [];
    const open = (): AsyncIterable<number> => {
      opens.push(Date.now());
      return stream([1]);
    };
    const ac = new AbortController();
    void watchWithBackoff(open, { onFrame: () => undefined, onError: (e) => errors.push(e) }, ac.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(opens).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(opens).toHaveLength(2);
    expect(errors).toEqual([]);
    ac.abort();
  });

  it('abort во время паузы останавливает цикл и снимает таймер', async () => {
    const opens: number[] = [];
    const ac = new AbortController();
    const done = watchWithBackoff(failing(opens), { onFrame: () => undefined, onError: () => undefined }, ac.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    ac.abort();
    await done;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(opens).toHaveLength(1);
  });

  it('ошибка, вызванная abort, наружу не уходит', async () => {
    const errors: unknown[] = [];
    const ac = new AbortController();
    const open = (signal: AbortSignal): AsyncIterable<number> =>
      (async function* (): AsyncGenerator<number> {
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => { reject(new Error('canceled')); });
        });
        yield 0;
      })();
    const done = watchWithBackoff(open, { onFrame: () => undefined, onError: (e) => errors.push(e) }, ac.signal);
    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await done;
    expect(errors).toEqual([]);
  });

  it('синхронный сбой open() обрабатывается как сбой потока', async () => {
    const errors: unknown[] = [];
    let n = 0;
    const open = (): AsyncIterable<number> => {
      n += 1;
      throw new Error('sync');
    };
    const ac = new AbortController();
    void watchWithBackoff(open, { onFrame: () => undefined, onError: (e) => errors.push(e) }, ac.signal);
    await vi.advanceTimersByTimeAsync(1000);
    expect(n).toBe(2);
    expect(errors).toHaveLength(2);
    ac.abort();
  });
});
