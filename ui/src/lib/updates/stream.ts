// SPDX-License-Identifier: GPL-3.0-only

// stream.ts — чтение серверных стримов обновлений (T-75): передаёт события
// обработчику, обрывает стрим по отмене пользователя и по «тишине» (источник
// завис). Так экран не остаётся в «загрузке» навсегда, а отмена не считается ошибкой.

/** Чем закончилось чтение: до конца, отменено пользователем или оборвано из-за тишины. */
export type StreamEnd = 'done' | 'cancelled' | 'stalled';

export interface ReadOptions {
  /** Отмена снаружи: кнопка «Отменить» или уход с экрана. */
  readonly signal: AbortSignal;
  /** Сколько можно молчать (мс), пока не пришло очередное событие. */
  readonly idleMs: number;
}

/**
 * Читает стрим, который открывает `open(signal)`. Ошибка стрима (не отмена и не
 * тишина) пробрасывается вызывающему.
 */
export async function readStream<T>(
  open: (signal: AbortSignal) => AsyncIterable<T>,
  onEvent: (event: T) => void,
  options: ReadOptions,
): Promise<StreamEnd> {
  const cancelledByUser = (): boolean => options.signal.aborted;
  if (cancelledByUser()) return 'cancelled';
  const inner = new AbortController();
  const relay = (): void => {
    inner.abort();
  };
  options.signal.addEventListener('abort', relay, { once: true });
  const flags = { stalled: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      flags.stalled = true;
      inner.abort();
    }, options.idleMs);
  };
  try {
    arm();
    for await (const event of open(inner.signal)) {
      arm();
      onEvent(event);
    }
    return 'done';
  } catch (e) {
    if (flags.stalled) return 'stalled';
    if (cancelledByUser()) return 'cancelled';
    throw e;
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', relay);
  }
}
