// SPDX-License-Identifier: GPL-3.0-only

// serialQueue.ts — строгий порядок асинхронных операций: следующая начинается,
// когда закончилась предыдущая (успехом или ошибкой). Нужен системному прокси
// (T-82): команда оболочки работает в пуле потоков, и два быстрых вызова
// «включить» / «выключить» иначе могли бы выполниться в обратном порядке.

export type SerialQueue = <T>(job: () => Promise<T>) => Promise<T>;

export function serialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}
