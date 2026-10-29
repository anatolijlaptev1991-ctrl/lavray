// SPDX-License-Identifier: GPL-3.0-only

// useKbdLabel.ts — подписи сочетаний клавиш для ОС хоста и языка интерфейса.
import { useCallback, useMemo } from 'react';
import { kbdLabel } from '../lib/hotkeys';
import { detectOS } from '../platform/adapter';
import { useI18n } from './useI18n';

/** kbd('K') → «Ctrl+K», «⌘K» или «Strg+K»; kbd('Esc') → «Esc». */
export function useKbdLabel(): (key: string) => string {
  const { lang } = useI18n();
  const os = useMemo(() => detectOS(window), []);
  return useCallback((key: string): string => kbdLabel(key, os, lang), [os, lang]);
}
