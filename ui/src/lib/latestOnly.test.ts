// SPDX-License-Identifier: GPL-3.0-only

// latestOnly.test.ts — один запрос в полёте и обязательная финальная проверка.
import { describe, expect, it } from 'vitest';
import { latestOnly } from './latestOnly';

function deferredRuns(): { run: () => Promise<void>; starts: () => number; finish: (i: number, fail?: boolean) => Promise<void> } {
  const pending: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  return {
    run: (): Promise<void> => new Promise<void>((resolve, reject) => { pending.push({ resolve, reject }); }),
    starts: (): number => pending.length,
    finish: async (i, fail = false): Promise<void> => {
      if (fail) pending[i]?.reject(new Error('x'));
      else pending[i]?.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('latestOnly', () => {
  it('серия вызовов в полёте даёт один финальный запрос после завершения', async () => {
    const d = deferredRuns();
    const trigger = latestOnly(d.run);
    for (let i = 0; i < 20; i += 1) trigger();
    expect(d.starts()).toBe(1);
    await d.finish(0);
    expect(d.starts()).toBe(2); // финальная проверка
    await d.finish(1);
    expect(d.starts()).toBe(2); // больше ничего не копилось
  });

  it('без вызовов во время полёта повторного запроса нет, новый вызов после завершения стартует сразу', async () => {
    const d = deferredRuns();
    const trigger = latestOnly(d.run);
    trigger();
    await d.finish(0);
    expect(d.starts()).toBe(1);
    trigger();
    expect(d.starts()).toBe(2);
  });

  it('ошибка запроса не блокирует следующие', async () => {
    const d = deferredRuns();
    const trigger = latestOnly(d.run);
    trigger();
    trigger();
    await d.finish(0, true);
    expect(d.starts()).toBe(2);
  });
});
