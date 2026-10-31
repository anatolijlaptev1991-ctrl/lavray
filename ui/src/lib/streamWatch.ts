// SPDX-License-Identifier: GPL-3.0-only

// streamWatch.ts — чтение server-stream RPC с переподключением (T-79). Поток
// ядра может оборваться (перезапуск ядра, сеть); экран не должен молча замирать:
// ошибка отдаётся наружу, а подписка возобновляется с нарастающей паузой.
//
// Пауза до очередной попытки: 1 с → 2 с → 4 с → … не больше 30 с. Первый же
// полученный кадр возвращает её к 1 с. «Кадра ещё нет» ошибкой НЕ считается:
// по HTTP/1.1 заголовки потока могут прийти только вместе с первым кадром, так
// что таймаута ожидания нет — сбой это только ошибка или конец потока.

export const BACKOFF_START_MS = 1000;
export const BACKOFF_CAP_MS = 30_000;

export interface WatchHandlers<T> {
  readonly onFrame: (frame: T) => void;
  /** Поток оборвался ошибкой; попытка повторится сама. */
  readonly onError: (error: unknown) => void;
}

/** Следующая пауза: вдвое больше, но не выше потолка. */
export const nextBackoff = (ms: number): number => Math.min(ms * 2, BACKOFF_CAP_MS);

/** Ждёт `ms` или abort — что раньше; таймер всегда снимается. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Читает поток, пока `signal` не оборван. Конец потока без ошибки считается
 * потерей связи: ядро держит подписку открытой, пока работает.
 */
export async function watchWithBackoff<T>(
  open: (signal: AbortSignal) => AsyncIterable<T>,
  handlers: WatchHandlers<T>,
  signal: AbortSignal,
): Promise<void> {
  let delay = BACKOFF_START_MS;
  const stopped = (): boolean => signal.aborted;
  while (!stopped()) {
    try {
      for await (const frame of open(signal)) {
        delay = BACKOFF_START_MS;
        handlers.onFrame(frame);
      }
    } catch (e) {
      if (stopped()) return;
      handlers.onError(e);
    }
    await sleep(delay, signal);
    delay = nextBackoff(delay);
  }
}
