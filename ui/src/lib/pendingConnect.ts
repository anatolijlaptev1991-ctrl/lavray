// SPDX-License-Identifier: GPL-3.0-only

// pendingConnect.ts — одноразовое намерение «подключиться после перезапуска от
// администратора». Пользователь нажал «Подключить» в режиме TUN без прав и
// согласился на перезапуск через UAC: новый экземпляр должен довести подключение
// до конца, а не ждать второго нажатия. Намерение лежит в `localStorage` и, как
// общий ключ, в `ui-state.json` (у повышенного экземпляра свой профиль WebView).
// Читается ровно один раз и удаляется; старше двух минут — не исполняется.

/** Ключ в `localStorage` и `ui-state.json` (должен быть в списках оболочки). */
export const PENDING_CONNECT_KEY = 'lavray.pendingConnect';

/** Сколько живёт намерение: дольше — пользователь уже мог передумать. */
export const PENDING_CONNECT_TTL_MS = 2 * 60 * 1000;

export type PendingMode = 'tun' | 'system_proxy';

export interface PendingConnect {
  readonly profileId: bigint;
  readonly mode: PendingMode;
  /** Время сохранения, мс с начала эпохи. */
  readonly ts: number;
}

/** Запомнить намерение (до `relaunch_elevated`); сбой хранилища не ошибка. */
export function savePendingConnect(storage: Storage, intent: PendingConnect): void {
  try {
    storage.setItem(
      PENDING_CONNECT_KEY,
      JSON.stringify({ profileId: intent.profileId.toString(), mode: intent.mode, ts: intent.ts }),
    );
  } catch {
    /* хранилище недоступно — подключаться придётся вручную */
  }
}

/** Снять намерение (отказ в UAC, сбой перезапуска). */
export function clearPendingConnect(storage: Storage): void {
  try {
    storage.removeItem(PENDING_CONNECT_KEY);
  } catch {
    /* нечего снимать */
  }
}

function parse(raw: string): PendingConnect | null {
  const p = JSON.parse(raw) as { profileId?: unknown; mode?: unknown; ts?: unknown };
  const idOk = typeof p.profileId === 'string' && /^[1-9]\d{0,18}$/.test(p.profileId);
  const modeOk = p.mode === 'tun' || p.mode === 'system_proxy';
  if (!idOk || !modeOk || typeof p.ts !== 'number' || !Number.isFinite(p.ts)) return null;
  return { profileId: BigInt(p.profileId as string), mode: p.mode as PendingMode, ts: p.ts };
}

/**
 * Забрать намерение: прочитать и удалить. `null` — его не было, оно испорчено,
 * «из будущего» или старше двух минут. Удаляется в любом случае, поэтому не
 * исполнится дважды.
 */
export function takePendingConnect(storage: Storage, now: number): PendingConnect | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(PENDING_CONNECT_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  clearPendingConnect(storage);
  try {
    const intent = parse(raw);
    if (intent === null) return null;
    const age = now - intent.ts;
    return age >= 0 && age <= PENDING_CONNECT_TTL_MS ? intent : null;
  } catch {
    return null;
  }
}
