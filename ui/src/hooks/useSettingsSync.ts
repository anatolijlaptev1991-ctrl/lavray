// SPDX-License-Identifier: GPL-3.0-only

// useSettingsSync.ts — живая карта настроек ядра: GetSettings + поток
// SubscribeSettings. Поток не шлёт начальный кадр, а заголовки ответа приходят
// вместе с первым событием, поэтому момент «подписались» не наблюдается: карту
// перечитываем сразу после запуска подписки и после каждого обрыва (ABORTED —
// ядро отключило медленного подписчика, пропущенные изменения догоняет GetSettings).
// Обрыв любого рода → повтор с нарастающей паузой; размонтирование останавливает всё.
import { useEffect, useState } from 'react';
import { Code, ConnectError } from '@connectrpc/connect';
import type { SettingsChanged } from '../gen/lavray_pb';
import type { CoreClients } from '../lib/core';
import { valuesOf } from '../lib/settingValues';
import { useCore } from './useCore';

export type SettingsMap = Readonly<Record<string, string | boolean | number>>;

/** Паузы между попытками переподключения, мс: растут вдвое до предела. */
export const BACKOFF_FIRST_MS = 500;
export const BACKOFF_MAX_MS = 15_000;

export function nextBackoff(previousMs: number): number {
  return previousMs === 0 ? BACKOFF_FIRST_MS : Math.min(previousMs * 2, BACKOFF_MAX_MS);
}

/**
 * Пауза перед следующей подпиской. Если связь держалась (были события) или ядро
 * штатно сбросило подписчика (ABORTED), счёт начинается заново; иначе пауза растёт.
 */
export function retryWait(previousMs: number, connectionHeld: boolean): number {
  return connectionHeld ? BACKOFF_FIRST_MS : nextBackoff(previousMs);
}

/** Карта после события: изменённое заменяется, сброшенное к умолчанию убирается. */
export function applyChange(map: SettingsMap, ev: SettingsChanged): SettingsMap {
  const next: Record<string, string | boolean | number> = { ...map, ...valuesOf(ev.changed) };
  for (const key of ev.removed) Reflect.deleteProperty(next, key);
  return next;
}

/** Чтение всей карты; прерывается вместе с подпиской (смена ядра отменяет запрос). */
async function readAll(core: CoreClients, signal: AbortSignal): Promise<SettingsMap> {
  return valuesOf((await core.settings.getSettings({}, { signal })).values);
}

/** Пауза, прерываемая отменой: возвращает false, если отменили. */
function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const done = (value: boolean): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = (): void => {
      done(false);
    };
    const timer = setTimeout(() => {
      done(true);
    }, ms);
    signal.addEventListener('abort', onAbort);
  });
}

/** Что подписка успела получить: по этому решается, сбрасывать ли паузу повтора. */
interface Progress {
  received: boolean;
}

/** Одна подписка: читает поток до конца или до ошибки; события отмечаются в `progress`. */
async function listen(
  core: CoreClients,
  signal: AbortSignal,
  onMap: (update: (prev: SettingsMap) => SettingsMap) => void,
  progress: Progress,
): Promise<void> {
  const iterator = core.settings.subscribeSettings({}, { signal })[Symbol.asyncIterator]();
  const first = iterator.next(); // запрос уходит здесь, раньше GetSettings
  first.catch(() => undefined); // обрыв до await ниже не должен стать необработанным отказом
  try {
    const initial = await readAll(core, signal);
    // Ответ старого ядра после его смены в карту не попадает.
    if (!signal.aborted) onMap((prev) => ({ ...prev, ...initial }));
  } catch {
    /* ядро ответит при следующем круге: поток всё равно читаем */
  }
  for (let step = await first; step.done !== true; step = await iterator.next()) {
    progress.received = true;
    const ev = step.value;
    onMap((prev) => applyChange(prev, ev));
  }
}

export function useSettingsSync(): SettingsMap {
  const core = useCore();
  const [map, setMap] = useState<SettingsMap>({});
  useEffect(() => {
    const ac = new AbortController();
    // Функция, а не чтение поля: TS считает `aborted` ложным после проверки в while.
    const stopped = (): boolean => ac.signal.aborted;
    void (async (): Promise<void> => {
      let wait = 0;
      while (!stopped()) {
        const progress: Progress = { received: false };
        let aborted = false;
        try {
          await listen(core, ac.signal, setMap, progress);
        } catch (e) {
          if (stopped()) return;
          // ABORTED — штатный сброс подписчика: догоняем быстро, пауза не растёт.
          aborted = ConnectError.from(e).code === Code.Aborted;
        }
        // Были события — связь держалась, пауза начинается заново; иначе нарастает.
        wait = retryWait(wait, progress.received || aborted);
        if (!(await pause(wait, ac.signal))) return;
      }
    })();
    return (): void => {
      ac.abort();
    };
  }, [core]);
  return map;
}
