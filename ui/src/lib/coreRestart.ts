// SPDX-License-Identifier: GPL-3.0-only

// coreRestart.ts — перезапустить ядро командой оболочки `restart_core` и дождаться
// его готовности. После выдачи прав для TUN (Linux) ядро должно стартовать заново,
// чтобы получить их. Оболочка поднимает ядро на новом порту с новым токеном и
// сообщает адрес событием `core-endpoint` (lib/coreEndpoint.ts): готовность — это
// новый непустой адрес.
import { getCoreEndpoint, subscribeCoreEndpoint } from './coreEndpoint';

/** Сколько ждём новый адрес ядра. */
export const CORE_RESTART_WAIT_MS = 30_000;

// Пока идёт ожидаемый перезапуск, оболочка шлёт `core-endpoint` с пустым адресом
// («ядра нет»), и опрос статуса падает: экран «Подключение» не должен в это время
// показывать «ядро недоступно». После таймаута флаг снимается — ошибка обычная.
let restarting = 0;
const restartListeners = new Set<() => void>();

function setRestarting(delta: number): void {
  restarting += delta;
  restartListeners.forEach((listener) => {
    listener();
  });
}

/** Идёт ожидаемый перезапуск ядра по просьбе окна. */
export function isCoreRestarting(): boolean {
  return restarting > 0;
}

export function subscribeCoreRestart(listener: () => void): () => void {
  restartListeners.add(listener);
  return (): void => {
    restartListeners.delete(listener);
  };
}

function waitForNewEndpoint(before: { url: string; token: string }, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = (): boolean => {
      const now = getCoreEndpoint();
      // Пустой адрес (`core-endpoint` «ядра нет») в окне выглядит как заглушка :0 — это не готовность.
      const live = (window.__LAVRAY_CORE_URL ?? '') !== '';
      return live && (now.url !== before.url || now.token !== before.token);
    };
    if (check()) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      off();
      reject(new Error('core_restart_timeout'));
    }, timeoutMs);
    const off = subscribeCoreEndpoint(() => {
      if (!check()) return;
      clearTimeout(timer);
      off();
      resolve();
    });
  });
}

export async function restartCoreAndWait(timeoutMs: number = CORE_RESTART_WAIT_MS): Promise<void> {
  setRestarting(1);
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const before = getCoreEndpoint();
    await invoke<unknown>('restart_core');
    await waitForNewEndpoint(before, timeoutMs);
  } finally {
    setRestarting(-1);
  }
}
