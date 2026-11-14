// SPDX-License-Identifier: GPL-3.0-only

// useElevated.ts — права администратора у оболочки (T-46, T-81): бейдж «админ»
// на пункте TUN и предупреждение «Для TUN запустите от администратора».
// На Linux права выдаются ядру, а не процессу (hooks/useTunAccess.ts), поэтому
// там ответ всегда `null`: `is_elevated` (euid == 0) про TUN ничего не говорит.
import { useEffect, useState } from 'react';
import { isElevated } from '../lib/elevation';
import { useShellCaps } from './useShellCaps';

/**
 * Запущена ли оболочка с правами администратора: `true`/`false` — оболочка
 * ответила, `null` — ещё не ответила, оболочки нет (веб-панель) или права
 * выдаются ядру (Linux).
 */
export function useElevated(): boolean | null {
  const [elevated, setElevated] = useState<boolean | null>(null);
  const grant = useShellCaps().tunAccess === 'grant';
  useEffect(() => {
    if (grant) return undefined;
    let live = true;
    void isElevated().then((value) => {
      if (live) setElevated(value);
    });
    return (): void => {
      live = false;
    };
  }, [grant]);
  return grant ? null : elevated;
}
