// SPDX-License-Identifier: GPL-3.0-only

// useSystemProxy.ts — применён ли системный прокси (по результатам команды
// set_system_proxy в этом окне); источник — lib/connection.ts.
import { useSyncExternalStore } from 'react';
import { isSystemProxyApplied, onSystemProxyChange } from '../lib/connection';

export function useSystemProxyApplied(): boolean {
  return useSyncExternalStore(onSystemProxyChange, isSystemProxyApplied, isSystemProxyApplied);
}
