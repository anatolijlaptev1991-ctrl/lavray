// SPDX-License-Identifier: GPL-3.0-only

// runners.ts — три асинхронных шага «Центра обновлений» (T-75): проверка,
// загрузка, установка. Каждый шаг ходит в ядро (и оболочку) и превращает
// результат в действия автомата через `dispatch`; React тут не нужен.
import { UpdateChannel, UpdateComponent } from '../../gen/lavray_pb';
import type { UpdateEvent } from '../../gen/lavray_pb';
import type { CoreClients } from '../core';
import { appUpdateOf, versionsOf } from './appUpdate';
import { classifyCoreError, shellErrorKey, shellRetryTarget } from './errors';
import type { Failure } from './errors';
import { applySignal, downloadAction } from './events';
import { applyUpdate } from './shell';
import { readStream } from './stream';
import type { ApplySignal } from './events';
import type { AvailableUpdate, Channel, ErrorInfo, FlowAction, StagedUpdate } from './types';

/** Сколько можно молчать стриму загрузки, прежде чем счесть источник зависшим. */
export const DOWNLOAD_IDLE_MS = 90_000;
/** То же для повторной проверки перед установкой. */
export const APPLY_IDLE_MS = 60_000;

export type Dispatch = (action: FlowAction) => void;

const APP_ONLY = [UpdateComponent.APP];

/** Проверка. Возвращает время успешной проверки (мс) или `null`, если проверка не удалась. */
export async function runCheck(core: CoreClients, channel: Channel, dispatch: Dispatch): Promise<number | null> {
  try {
    const res = await core.updates.checkUpdates({
      channel: channel === 'beta' ? UpdateChannel.BETA : UpdateChannel.STABLE,
    });
    dispatch({ type: 'checkDone', update: appUpdateOf(res, channel), versions: versionsOf(res) });
    return Number(res.lastCheckedAtMs);
  } catch (e) {
    dispatch({ type: 'checkFailed', failure: classifyCoreError(e) });
    return null;
  }
}

/** Ошибка RPC во время загрузки → что показать и что повторять. */
function downloadErrorOf(f: Failure): { error: ErrorInfo; retry: 'download' | 'check' } {
  if (f.kind === 'running') return { error: { key: f.key, detail: '' }, retry: 'download' };
  const specific = f.kind === 'notConfigured' || (f.kind === 'error' && f.key !== 'upd.err.generic');
  // Нет проверенного манифеста или отказ по причине: нужна новая проверка, а не повтор загрузки.
  if (specific) return { error: { key: f.key, detail: f.detail }, retry: 'check' };
  return { error: { key: 'upd.dlFailed', detail: '' }, retry: 'download' };
}

const failedDownload = (key: ErrorInfo['key']): FlowAction => ({
  type: 'downloadFailed',
  error: { key, detail: '' },
  retry: 'download',
});

/** Загрузка: прогресс, проверка подписи и суммы ядром, итог — `verified` или причина отказа. */
export async function runDownload(
  core: CoreClients,
  update: AvailableUpdate,
  dispatch: Dispatch,
  signal: AbortSignal,
  idleMs: number,
): Promise<void> {
  // Итог уже получен (verified / отказ): дальнейшие события и конец потока его не меняют.
  const result = { finished: false };
  const onEvent = (ev: UpdateEvent): void => {
    if (result.finished) return;
    const action = downloadAction(ev, update.version);
    if (action === null) return;
    dispatch(action);
    result.finished = action.type === 'verified' || action.type === 'downloadFailed';
  };
  try {
    const open = (s: AbortSignal): AsyncIterable<UpdateEvent> =>
      core.updates.downloadUpdates({ components: APP_ONLY }, { signal: s });
    const end = await readStream(open, onEvent, { signal, idleMs });
    if (result.finished) return;
    if (end === 'cancelled') dispatch({ type: 'downloadCancelled' });
    else dispatch(failedDownload(end === 'stalled' ? 'upd.stalled' : 'upd.dlFailed'));
  } catch (e) {
    if (!result.finished) dispatch({ type: 'downloadFailed', ...downloadErrorOf(classifyCoreError(e)) });
  }
}

export interface InstallOptions {
  readonly staged: StagedUpdate;
  /** Пользователь разрешил разрыв активной VPN-сессии. */
  readonly confirmed: boolean;
  readonly signal: AbortSignal;
  readonly idleMs: number;
}

type Reverify = ApplySignal | { readonly kind: 'cancelled' } | { readonly kind: 'session' };

const failedApply = (key: ErrorInfo['key'], detail: string, retry: 'install' | 'download'): Reverify => ({
  kind: 'failed',
  error: { key, detail },
  retry,
});

/** Повторная проверка копии ядром: ждём `readyForRestart` или отказ. */
async function reverify(core: CoreClients, o: InstallOptions): Promise<Reverify> {
  const seen: { value: ApplySignal | null } = { value: null };
  try {
    const open = (s: AbortSignal): AsyncIterable<UpdateEvent> =>
      core.updates.applyUpdates({ components: APP_ONLY, activeSessionConfirmed: o.confirmed }, { signal: s });
    const end = await readStream(
      open,
      (ev) => {
        seen.value ??= applySignal(ev);
      },
      { signal: o.signal, idleMs: o.idleMs },
    );
    if (seen.value !== null) return seen.value;
    if (end === 'cancelled') return { kind: 'cancelled' };
    return failedApply(end === 'stalled' ? 'upd.stalled' : 'upd.err.generic', '', 'install');
  } catch (e) {
    if (seen.value !== null) return seen.value;
    const f = classifyCoreError(e);
    if (f.kind === 'activeSession') return { kind: 'session' };
    return failedApply(f.kind === 'network' ? 'upd.err.generic' : f.key, f.detail, 'install');
  }
}

/** Запуск установщика оболочкой после успешной повторной проверки. */
async function launch(staged: StagedUpdate, dispatch: Dispatch): Promise<void> {
  try {
    const outcome = await applyUpdate(staged);
    // 'installing': состояние не меняем — оболочка вот-вот закроет приложение.
    if (outcome === 'uac_cancelled') dispatch({ type: 'uacCancelled' });
  } catch (e) {
    dispatch({ type: 'installFailed', error: { key: shellErrorKey(e), detail: '' }, retry: shellRetryTarget(e) });
  }
}

/** Установка: ApplyUpdates до `readyForRestart`, затем `update_apply` оболочки. */
export async function runInstall(core: CoreClients, dispatch: Dispatch, o: InstallOptions): Promise<void> {
  const verdict = await reverify(core, o);
  switch (verdict.kind) {
    case 'cancelled':
      return;
    case 'session':
      dispatch({ type: 'needSessionConfirm' });
      return;
    case 'failed':
      dispatch({ type: 'installFailed', error: verdict.error, retry: verdict.retry });
      return;
    case 'ready':
      await launch(o.staged, dispatch);
  }
}
