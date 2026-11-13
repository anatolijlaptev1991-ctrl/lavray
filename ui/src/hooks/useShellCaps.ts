// SPDX-License-Identifier: GPL-3.0-only

// useShellCaps.ts — возможности оболочки в React (lib/shellCaps.ts) и перевод
// с вариантами для Linux (lib/platformText.ts).
import { useCallback, useSyncExternalStore } from 'react';
import { getShellCaps, subscribeShellCaps, type ShellCaps } from '../lib/shellCaps';
import { platformKey, type PlatformKey } from '../lib/platformText';
import { useI18n } from './useI18n';

export function useShellCaps(): ShellCaps {
  return useSyncExternalStore(subscribeShellCaps, getShellCaps, getShellCaps);
}

/** Перевод текста, у которого на Linux свой вариант: `pt('mode.tun.hint')`. */
export function usePlatformText(): (key: PlatformKey) => string {
  const { t } = useI18n();
  const caps = useShellCaps();
  return useCallback((key: PlatformKey): string => t(platformKey(key, caps)), [t, caps]);
}

/**
 * Обновления приходят пакетом ОС, а не из приложения: оболочка есть, а
 * самообновления нет (Linux). В вебе оболочки нет — там прежнее поведение.
 */
export function usePackageUpdates(): boolean {
  const caps = useShellCaps();
  return caps.os !== 'web' && !caps.selfUpdate;
}
