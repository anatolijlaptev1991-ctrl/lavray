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
import type { CoreState } from '../gen/lavray_pb';

/** Порт входящего подключения, пока ядро его не сообщило (inbound.port по умолчанию). */
const DEFAULT_PORT = 2080;

export function useSystemProxyFollow(status: CoreStatus): void {
  const previous = useRef<CoreState | null>(null);
  const { state, mode } = status;
  const port = status.inbound?.port;
  useEffect(() => {
    const action = followAction({
      prev: previous.current,
      next: state,
      mode,
      sysProxyWanted: loadModes(window.localStorage).sysProxy,
      applied: isSystemProxyApplied(),
      busy: isOwnChangeBusy(),
      kept: isProxyKept(), // kill switch: после падения ядра прокси остаётся до решения пользователя
    });
    previous.current = state;
    // Вне оболочки (веб-панель) прокси ОС ставить нечем.
    if (action === null || (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === undefined) {
      return;
    }
    const change =
      action === 'apply' ? applySystemProxy(true, port ?? DEFAULT_PORT) : releaseUnlessKept();
    // Оболочка отказала — чип «Системный прокси» в статус-баре остаётся погашенным.
    change.catch(() => undefined);
  }, [state, mode, port]);
}
