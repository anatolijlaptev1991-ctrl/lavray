// SPDX-License-Identifier: GPL-3.0-only

// useAgentAccess.ts — окно сообщает оболочке режим доступа агентов из настройки
// ядра: при запуске и после каждого перезапуска ядра (новый адрес и токен — новые
// клиенты). Файл agent-endpoint.json без этого не появился бы, пока режим не
// переключат вручную. Изменения режима в «Настройках» оболочке сообщает сам экран.
import { useEffect } from 'react';
import { useCore } from './useCore';
import { loadAgentMode, relayAgentMode } from '../lib/agents';

export function useAgentAccessSync(): void {
  const core = useCore();
  useEffect(() => {
    // Объект, а не переменная: TS считает `let live = true` вечно истинной в IIFE.
    const guard = { live: true };
    void (async (): Promise<void> => {
      try {
        const mode = await loadAgentMode(core);
        if (guard.live) await relayAgentMode(mode);
      } catch {
        /* ядро ещё не готово или оболочки нет: повтор — при следующих клиентах ядра */
      }
    })();
    return (): void => {
      guard.live = false;
    };
  }, [core]);
}
