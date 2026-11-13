// SPDX-License-Identifier: GPL-3.0-only

// platformText.ts — тексты, у которых на Linux свой вариант (без слов
// «администратор», UAC, Windows, `.exe` и путей Windows). Вариант лежит в
// словаре под ключом `<ключ>.lx`; выбор — по возможностям оболочки
// (lib/shellCaps.ts), экраны не проверяют ОС сами.
import { getShellCaps, type ShellCaps } from './shellCaps';
import type { MessageKey } from './i18n';

/** Ключи, у которых есть вариант `.lx` во всех пяти словарях. */
export const PLATFORM_KEYS = [
  'mode.admin',
  'mode.tun.needAdmin',
  'mode.tun.hint',
  'set.tunD',
  'set.autoConnect.d',
  'toast.tunReady',
  'err.tunAccess',
  'agent.cfg.d',
  'agent.noPath',
  'rt.proc.namesPh',
  'nb.pathHint',
  'nb.none',
] as const;

export type PlatformKey = (typeof PLATFORM_KEYS)[number];

/** Показывать тексты для Linux. */
export function usesLinuxText(caps: ShellCaps): boolean {
  return caps.os === 'linux';
}

/** Ключ словаря для текущей ОС. */
export function platformKey(key: PlatformKey, caps: ShellCaps = getShellCaps()): MessageKey {
  return usesLinuxText(caps) ? `${key}.lx` : key;
}
