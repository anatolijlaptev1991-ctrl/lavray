// SPDX-License-Identifier: GPL-3.0-only

// useLocalInstall.ts — «Установить из файла» (T-75): диалог выбора установщика
// даёт оболочка (путь страница не вводит), ядро проверяет подпись той же
// цепочкой (VerifyLocalUpdate), установку запускает оболочка. Состояния: пусто →
// выбор → проверка → «проверено» / «отклонено» / ошибка → установка.
import { Code, ConnectError } from '@connectrpc/connect';
import { useCallback, useRef, useState } from 'react';
import type { CoreClients } from '../lib/core';
import type { MessageKey } from '../lib/i18n';
import { classifyCoreError, shellErrorKey } from '../lib/updates/errors';
import { applyUpdate, pickInstaller } from '../lib/updates/shell';
import type { StagedInstaller } from '../lib/updates/shell';
import { useCore } from './useCore';

export type LocalState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'valid'; readonly staged: StagedInstaller; readonly version: string; readonly notice: boolean }
  | { readonly kind: 'invalid'; readonly errors: readonly string[] }
  | { readonly kind: 'error'; readonly key: MessageKey }
  | { readonly kind: 'installing' };

export interface LocalInstall {
  readonly state: LocalState;
  readonly pick: () => void;
  readonly install: () => void;
}

const IDLE: LocalState = { kind: 'idle' };

/** Проверка выбранного установщика ядром той же цепочкой доверия, что и скачанного. */
async function verifyInstaller(core: CoreClients, staged: StagedInstaller): Promise<LocalState> {
  try {
    const res = await core.updates.verifyLocalUpdate({ installerPath: staged.stagedPath });
    if (res.valid && res.manifest !== undefined) {
      return { kind: 'valid', staged, version: res.manifest.version, notice: false };
    }
    return { kind: 'invalid', errors: res.errors };
  } catch (e) {
    // Путь вне staging — INVALID_ARGUMENT: файл не принимается, как и неподписанный.
    if (ConnectError.from(e).code === Code.InvalidArgument) {
      return { kind: 'error', key: 'upd.err.path_outside_staging' };
    }
    return { kind: 'error', key: classifyCoreError(e).key };
  }
}

export function useLocalInstall(): LocalInstall {
  const core = useCore();
  const [state, setState] = useState<LocalState>(IDLE);
  const busy = useRef(false);

  const pick = useCallback((): void => {
    if (busy.current) return;
    busy.current = true;
    setState({ kind: 'working' });
    void (async (): Promise<void> => {
      try {
        const staged = await pickInstaller();
        setState(staged === null ? IDLE : await verifyInstaller(core, staged));
      } catch (e) {
        setState({ kind: 'error', key: shellErrorKey(e) });
      } finally {
        busy.current = false;
      }
    })();
  }, [core]);

  const install = useCallback((): void => {
    if (busy.current || state.kind !== 'valid') return;
    const { staged, version } = state;
    busy.current = true;
    setState({ kind: 'installing' });
    void (async (): Promise<void> => {
      try {
        const outcome = await applyUpdate({ stagedPath: staged.stagedPath, sha256: staged.sha256, version });
        // 'installing': оболочка вот-вот закроет приложение; отказ в UAC — назад к «проверено».
        if (outcome === 'uac_cancelled') setState({ kind: 'valid', staged, version, notice: true });
      } catch (e) {
        setState({ kind: 'error', key: shellErrorKey(e) });
      } finally {
        busy.current = false;
      }
    })();
  }, [state]);

  return { state, pick, install };
}
