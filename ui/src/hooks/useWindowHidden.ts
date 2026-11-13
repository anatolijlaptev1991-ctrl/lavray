// SPDX-License-Identifier: GPL-3.0-only

// useWindowHidden.ts — окно скрыто в трей (lib/windowVisibility.ts): компоненты
// по нему останавливают таймеры и перерисовки; при показе всё возобновляется.
import { useSyncExternalStore } from 'react';
import { isWindowHidden, subscribeWindowHidden } from '../lib/windowVisibility';

export function useWindowHidden(): boolean {
  return useSyncExternalStore(subscribeWindowHidden, isWindowHidden, () => false);
}
