// SPDX-License-Identifier: GPL-3.0-only

// useConnectFlash.ts — счётчик «успешных подключений» для однократных эффектов фона
// (проход bf-streak и волна bf-ripple). Растёт при переходе в `on` из `mid` и при
// любом переходе в `on` после первой смены состояния. Первая смена — это загрузка
// статуса ядра (off → on у окна, открытого поверх уже работающего ядра): её не считаем.
import { useState } from 'react';
import type { BgConn } from '../lib/bgState';

interface Seen {
  readonly conn: BgConn;
  readonly count: number;
  readonly changes: number;
}

export function useConnectFlash(conn: BgConn): number {
  const [seen, setSeen] = useState<Seen>({ conn, count: 0, changes: 0 });
  if (seen.conn !== conn) {
    const flash = conn === 'on' && (seen.conn === 'mid' || seen.changes > 0);
    setSeen({ conn, count: seen.count + (flash ? 1 : 0), changes: seen.changes + 1 });
  }
  return seen.count;
}
