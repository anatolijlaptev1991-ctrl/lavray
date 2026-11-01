// SPDX-License-Identifier: GPL-3.0-only

// useRestartReset.ts — флаг «нужен перезапуск ядра» (lib/restartNeeded.ts) не должен
// пережить само событие, которого он ждёт: после отключения профиль уже не запущен, а
// после перезапуска ядра (новые клиенты: другой адрес и процесс) правка применена.
import { useEffect, useRef } from 'react';
import { CoreState } from '../gen/lavray_pb';
import { clearRestartNeeded } from '../lib/restartNeeded';
import { useCore } from './useCore';

export function useRestartReset(state: CoreState): void {
  const core = useCore();
  // Клиенты пересоздаются при новом адресе или токене ядра (useCoreClients).
  useEffect(() => {
    clearRestartNeeded();
  }, [core]);

  // Переход в IDLE из любого другого состояния — отключение (первый кадр не в счёт).
  const previous = useRef<CoreState | null>(null);
  useEffect(() => {
    if (previous.current !== null && previous.current !== CoreState.IDLE && state === CoreState.IDLE) {
      clearRestartNeeded();
    }
    previous.current = state;
  }, [state]);
}
