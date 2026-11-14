// SPDX-License-Identifier: GPL-3.0-only

// useSystemProxyFollow.ts — окно ставит и снимает системный прокси, когда ядро
// подключил или отключил другой клиент (MCP-агент). Правила — в lib/proxyFollow.ts.
import { useEffect, useRef } from 'react';
import type { CoreStatus } from './useCore';
import {
  applySystemProxy,
  isOwnChangeBusy,
  isSystemProxyApplied,
  loadModes,
} from '../lib/connection';
import { isProxyKept } from '../lib/killSwitch';
import { followAction } from '../lib/proxyFollow';
import { releaseUnlessKept } from '../lib/proxyRelease';
import { clearProxyError, reportProxyError } from '../lib/proxyError';
import { CoreState } from '../gen/lavray_pb';

/** Порт входящего подключения, пока ядро его не сообщило (inbound.port по умолчанию). */
const DEFAULT_PORT = 2080;

export function useSystemProxyFollow(status: CoreStatus): void {
  const previous = useRef<CoreState | null>(null);
  const seenReal = useRef(false);
  const { state, mode } = status;
  const port = status.inbound?.port;
  const real = status.coreVersion !== '';
  useEffect(() => {
    const initial = real && !seenReal.current;
    if (real) seenReal.current = true;
    const action = followAction({
      initial,
      prev: previous.current,
      next: state,
      mode,
      sysProxyWanted: loadModes(window.localStorage).sysProxy,
      applied: isSystemProxyApplied(),
      busy: isOwnChangeBusy(),
      kept: isProxyKept(), // kill switch: после падения ядра прокси остаётся до решения пользователя
    });
    previous.current = state;
    // Ядро отключилось или упало: прежняя ошибка прокси потеряла смысл.
    if (state === CoreState.IDLE || state === CoreState.ERROR) clearProxyError();
    // Вне оболочки (веб-панель) прокси ОС ставить нечем.
    if (action === null || (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === undefined) {
      return;
    }
    const change =
      action === 'apply' ? applySystemProxy(true, port ?? DEFAULT_PORT) : releaseUnlessKept();
    // Оболочка отказала — чип «Системный прокси» в статус-баре остаётся погашенным,
    // а причина попадает в журнал и на экран «Подключение» (раньше глоталась).
    change.then(clearProxyError, reportProxyError);
  }, [state, mode, port, real]);
}
