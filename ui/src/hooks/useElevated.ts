// SPDX-License-Identifier: GPL-3.0-only

// useElevated.ts — права администратора у оболочки (T-46, T-81): бейдж «админ»
// на пункте TUN и предупреждение «Для TUN запустите от администратора».
import { useEffect, useState } from 'react';
import { isElevated } from '../lib/elevation';

/**
 * Запущена ли оболочка с правами администратора: `true`/`false` — оболочка
 * ответила, `null` — ещё не ответила или оболочки нет (веб-панель).
 */
export function useElevated(): boolean | null {
  const [elevated, setElevated] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void isElevated().then((value) => {
      if (live) setElevated(value);
    });
    return (): void => {
      live = false;
    };
  }, []);
  return elevated;
}
