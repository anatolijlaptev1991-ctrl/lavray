// SPDX-License-Identifier: GPL-3.0-only

// tunRelaunch.ts — «Перезапустить от администратора» ради TUN (T-81). Выбор TUN
// записывается заранее (localStorage и ядро), а вместе с ним — одноразовое
// намерение подключиться (pendingConnect.ts): новый экземпляр сам доведёт
// подключение до конца. Отказ в UAC или сбой возвращают прежний выбор и снимают
// намерение: приложение остаётся как было.
import type { CoreClients } from './core';
import { relaunchElevated, type RelaunchOutcome } from './elevation';
import { rememberModes, saveModes, type ModePreferences } from './connection';
import { clearPendingConnect, savePendingConnect } from './pendingConnect';
import { saveUiStateNow } from './uiState';

export async function relaunchForTun(args: {
  readonly core: CoreClients;
  readonly prev: ModePreferences;
  /** Выбранный сервер; без него подключаться после перезапуска нечем. */
  readonly profileId: bigint | undefined;
}): Promise<RelaunchOutcome> {
  const { core, prev, profileId } = args;
  const storage = window.localStorage;
  const next = { ...prev, tunMode: true };
  const revert = (): void => {
    saveModes(storage, prev);
    clearPendingConnect(storage);
    void rememberModes(core, prev);
  };
  saveModes(storage, next);
  await rememberModes(core, next);
  if (profileId !== undefined) savePendingConnect(storage, { profileId, mode: 'tun', ts: Date.now() });
  // У повышенного экземпляра свой профиль WebView: общие настройки (режимы,
  // язык, тема, выбор сервера, намерение) он читает из файла оболочки, поэтому
  // запись должна завершиться до запуска нового экземпляра.
  await saveUiStateNow(storage);
  try {
    const outcome = await relaunchElevated();
    if (outcome === 'cancelled') revert();
    return outcome;
  } catch (e) {
    revert();
    throw e;
  }
}
