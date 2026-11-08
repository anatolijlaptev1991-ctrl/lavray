// SPDX-License-Identifier: GPL-3.0-only

// latestOnly.ts — «один запрос в полёте, остальное схлопывается». Частые
// события (resize окна) не плодят параллельные запросы: пока предыдущий не
// завершён, новые запоминаются одним флагом, а после завершения выполняется
// ровно один финальный запрос — итоговое состояние всегда проверено.

/** Возвращает триггер; `run` не вызывается параллельно сам с собой. Ошибки run гасит вызывающий. */
export function latestOnly(run: () => Promise<void>): () => void {
  let inFlight = false;
  let again = false;
  const go = (): void => {
    inFlight = true;
    void run().then(
      () => { settle(); },
      () => { settle(); },
    );
  };
  const settle = (): void => {
    inFlight = false;
    if (!again) return;
    again = false;
    go();
  };
  return (): void => {
    if (inFlight) again = true;
    else go();
  };
}
