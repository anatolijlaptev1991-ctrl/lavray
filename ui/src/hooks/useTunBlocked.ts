// SPDX-License-Identifier: GPL-3.0-only

// useTunBlocked.ts — режим TUN включён, а прав администратора нет (T-46).
import { useEffect, useState } from 'react';
import { isElevated } from '../lib/elevation';

/** `true`, пока выбран TUN и оболочка точно сообщила, что прав не хватает. */
export function useTunBlocked(tunMode: boolean): boolean {
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
  return tunMode && elevated === false;
}
