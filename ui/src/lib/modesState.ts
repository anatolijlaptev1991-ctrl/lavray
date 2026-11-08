// SPDX-License-Identifier: GPL-3.0-only

// modesState.ts — обновление состояния режимов подключения из хранилища без
// лишних рендеров: если sysProxy и tunMode не изменились, остаётся прежний объект.
import type { ModePreferences } from './connection';

/** Прежний объект, если значения те же; иначе новый. Для setState-функции. */
export function keepModes(prev: ModePreferences, next: ModePreferences): ModePreferences {
  return prev.sysProxy === next.sysProxy && prev.tunMode === next.tunMode ? prev : next;
}
