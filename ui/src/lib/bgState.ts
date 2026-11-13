// SPDX-License-Identifier: GPL-3.0-only

// bgState.ts — значение `data-conn` у фона #bgField по состоянию ядра.
// Четыре оттенка фона (прототип): off, mid (идёт подключение), on, err.
import { CoreState } from '../gen/lavray_pb';

export type BgConn = 'off' | 'mid' | 'on' | 'err';

export function bgConnOf(state: CoreState): BgConn {
  switch (state) {
    case CoreState.CONNECTED:
      return 'on';
    case CoreState.CONNECTING:
    case CoreState.RECONNECTING:
      return 'mid';
    case CoreState.ERROR:
      return 'err';
    default:
      return 'off';
  }
}
