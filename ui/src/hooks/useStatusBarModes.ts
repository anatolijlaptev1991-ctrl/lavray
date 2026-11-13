// SPDX-License-Identifier: GPL-3.0-only

// useStatusBarModes.ts — режимы (TUN, системный прокси) для чипов статус-бара.
// Экран «Подключение» меняет их в localStorage того же документа, а событие
// `storage` приходит только из других документов, поэтому раз в 1,5 с
// настройки перечитываются. Окно скрыто в трей: чипов никто не видит, опрос
// снят; при показе режимы перечитываются сразу.
import { useCallback, useEffect, useState } from 'react';
import { loadModes } from '../lib/connection';
import { keepModes } from '../lib/modesState';
import type { ModePreferences } from '../lib/connection';
import { useWindowHidden } from './useWindowHidden';

const SYNC_MS = 1500;

/** Режимы и функция «перечитать сейчас» (после онбординга, без ожидания опроса). */
export function useStatusBarModes(): readonly [ModePreferences, () => void] {
  const [modes, setModes] = useState(() => loadModes(window.localStorage));
  const hidden = useWindowHidden();
  const sync = useCallback((): void => {
    setModes((prev) => keepModes(prev, loadModes(window.localStorage)));
  }, []);
  useEffect(() => {
    if (hidden) return undefined;
    sync();
    window.addEventListener('storage', sync);
    const id = window.setInterval(sync, SYNC_MS);
    return (): void => {
      window.removeEventListener('storage', sync);
      window.clearInterval(id);
    };
  }, [hidden, sync]);
  return [modes, sync];
}
