// SPDX-License-Identifier: GPL-3.0-only

// coreRestart.ts — перезапустить ядро командой оболочки `restart_core` и дождаться
// его готовности. После выдачи прав для TUN (Linux) ядро должно стартовать заново,
// чтобы получить их. Оболочка поднимает ядро на новом порту с новым токеном и
// сообщает адрес событием `core-endpoint` (lib/coreEndpoint.ts): готовность — это
// новый непустой адрес.
import { getCoreEndpoint, subscribeCoreEndpoint } from './coreEndpoint';

/** Сколько ждём новый адрес ядра. */
export const CORE_RESTART_WAIT_MS = 20_000;

function waitForNewEndpoint(before: { url: string; token: string }, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = (): boolean => {
      const now = getCoreEndpoint();
      return now.url !== '' && (now.url !== before.url || now.token !== before.token);
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
  const { invoke } = await import('@tauri-apps/api/core');
  const before = getCoreEndpoint();
  await invoke<unknown>('restart_core');
  await waitForNewEndpoint(before, timeoutMs);
}
