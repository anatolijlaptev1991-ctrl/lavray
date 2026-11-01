// SPDX-License-Identifier: GPL-3.0-only

// useConnActions.ts — действия над строкой экрана «Соединения» (T-79):
// копирование адреса и закрытие соединения. Результат — короткая заметка
// (`note`), которая гаснет сама.
//
// CloseConnection отвечает NOT_FOUND, если соединение уже закрыто или инстанса
// нет: пользователь этого и хотел, так что это не ошибка и заметки не будет.
import { Code, ConnectError } from '@connectrpc/connect';
import { useCallback, useEffect, useState } from 'react';
import type { Connection } from '../gen/lavray_pb';
import { friendlyCoreError } from '../lib/core';
import { useCore } from './useCore';
import { useI18n } from './useI18n';

export interface ConnNote {
  readonly kind: 'ok' | 'err';
  readonly text: string;
}

export interface ConnActions {
  readonly note: ConnNote | null;
  /** Показать заметку (гаснет сама): итог «создать правило» и подобное. */
  readonly notify: (note: ConnNote) => void;
  readonly copyAddress: (c: Connection) => Promise<void>;
  readonly closeConnection: (c: Connection) => Promise<void>;
}

/** Через сколько заметка гаснет. */
export const NOTE_MS = 5000;

export function useConnActions(): ConnActions {
  const core = useCore();
  const { t } = useI18n();
  const [note, setNote] = useState<ConnNote | null>(null);

  useEffect(() => {
    if (note === null) return undefined;
    const id = setTimeout(() => {
      setNote(null);
    }, NOTE_MS);
    return (): void => {
      clearTimeout(id);
    };
  }, [note]);

  const copyAddress = useCallback(
    async (c: Connection): Promise<void> => {
      try {
        await navigator.clipboard.writeText(c.destination);
        setNote({ kind: 'ok', text: t('conns.copied') });
      } catch {
        setNote({ kind: 'err', text: t('conns.copyFailed') });
      }
    },
    [t],
  );

  const closeConnection = useCallback(
    async (c: Connection): Promise<void> => {
      try {
        await core.connections.closeConnection({ id: c.id });
      } catch (e) {
        if (ConnectError.from(e).code === Code.NotFound) return;
        setNote({ kind: 'err', text: friendlyCoreError(e, t) });
      }
    },
    [core, t],
  );

  return { note, notify: setNote, copyAddress, closeConnection };
}
