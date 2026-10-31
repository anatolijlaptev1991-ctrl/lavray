// SPDX-License-Identifier: GPL-3.0-only

// useLocked.ts — «вход закрыт»: true, пока не наступил момент until (мс). Сам
// снимает блокировку по таймеру, без опроса.
import { useEffect, useState } from 'react';

export function useLocked(until: number | null): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return undefined;
    const left = until - Date.now();
    if (left <= 0) return undefined;
    const id = setTimeout(() => {
      setNow(Date.now());
    }, left);
    return (): void => {
      clearTimeout(id);
    };
  }, [until]);
  return until !== null && until > Math.max(now, Date.now());
}
