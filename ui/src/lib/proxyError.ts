// SPDX-License-Identifier: GPL-3.0-only

// proxyError.ts — последняя ошибка включения системного прокси, которую окно
// получило без участия пользователя (после автозапуска и подключения извне:
// hooks/useSystemProxyFollow.ts). Раньше она глоталась, и прокси молча не
// включался. Показывает экран «Подключение»; запись попадает и в журнал
// интерфейса (lib/uiJournal.ts).
import { logUi } from './uiJournal';

let current: string | null = null;
const listeners = new Set<() => void>();

function set(next: string | null): void {
  if (current === next) return;
  current = next;
  listeners.forEach((listener) => {
    listener();
  });
}

/** Причина отказа оболочки из исключения: текст ошибки либо строка из Err(String). */
export function proxyErrorReason(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.trim() === '' ? 'unknown' : text.trim().slice(0, 300);
}

/** Запомнить и записать в журнал ошибку включения прокси. */
export function reportProxyError(e: unknown): void {
  const reason = proxyErrorReason(e);
  logUi('error', `system proxy: ${reason}`);
  set(reason);
}

/** Прокси включился или выключился штатно — прежняя ошибка неактуальна. */
export function clearProxyError(): void {
  set(null);
}

export function getProxyError(): string | null {
  return current;
}

export function subscribeProxyError(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}
