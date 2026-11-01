// SPDX-License-Identifier: GPL-3.0-only

// useUpdateHealth.ts — сигнал «приложение здорово» для отката обновления (T-75).
// После установки оболочка ждёт от новой версии `health.json`; не пришёл за 60 с —
// старая версия возвращается. Сигнал уходит ровно один раз за запуск приложения:
// когда ядро ответило (есть версия ядра) и первый кадр уже нарисован.
import { useEffect } from 'react';
import { inShell, reportHealthOk } from '../lib/updates/shell';

/** Сигнал уже ушёл (или уходит) в этом запуске; модуль живёт, пока жива страница. */
let reported = false;

/** Только для тестов: «новый запуск приложения». */
export function resetUpdateHealthForTests(): void {
  reported = false;
}

/** Ядро готово, когда оно уже ответило своей версией (первый успешный GetStatus). */
export function isCoreReady(status: { readonly coreVersion?: string | undefined }): boolean {
  return status.coreVersion !== undefined && status.coreVersion !== '';
}

export function useUpdateHealth(coreReady: boolean): void {
  useEffect(() => {
    // Эффект стартует после коммита рендера, поэтому первый кадр к этому моменту есть.
    if (!coreReady || reported || !inShell()) return;
    reported = true;
    reportHealthOk().catch(() => {
      // Запись не удалась — следующая готовность ядра повторит попытку.
      reported = false;
    });
  }, [coreReady]);
}
