// SPDX-License-Identifier: GPL-3.0-only

// events.ts — события стримов DownloadUpdates / ApplyUpdates → действия автомата
// (T-75). Чистые функции без побочных эффектов. Событие чужого компонента
// пропускается; `verified` без пути или суммы — сбой: такую копию оболочка
// установить не сможет.
import { UpdateComponent } from '../../gen/lavray_pb';
import type { UpdateEvent } from '../../gen/lavray_pb';
import { verifyReasonKey } from './errors';
import type { ErrorInfo, FlowAction } from './types';

/** Событие относится к приложению (старое ядро поле component не заполняет). */
const isApp = (component: UpdateComponent): boolean =>
  component === UpdateComponent.APP || component === UpdateComponent.UNSPECIFIED;

/** Отказы, которые говорят о негодных метаданных: повтор загрузки не поможет — нужна новая проверка. */
const METADATA_REASONS: ReadonlySet<string> = new Set([
  'not_configured',
  'bad_signature',
  'expired',
  'serial_rollback',
  'wrong_product',
  'wrong_channel',
  'root_rotation',
  'artifact_role_missing',
]);

const downloadFailed = (error: ErrorInfo, retry: 'download' | 'check'): FlowAction => ({
  type: 'downloadFailed',
  error,
  retry,
});

/** Действие автомата по событию загрузки; `null` — событие не меняет состояние. */
export function downloadAction(ev: UpdateEvent, fallbackVersion: string): FlowAction | null {
  const { kind } = ev;
  switch (kind.case) {
    case 'progress':
      return isApp(kind.value.component)
        ? {
            type: 'progress',
            downloaded: Number(kind.value.downloadedBytes),
            total: Number(kind.value.totalBytes),
            bps: kind.value.bps,
          }
        : null;
    case 'verified': {
      const v = kind.value;
      if (!isApp(v.component)) return null;
      if (v.stagedPath === '' || v.sha256 === '') {
        return downloadFailed({ key: 'upd.dlFailed', detail: '' }, 'download');
      }
      const version = v.version === '' ? fallbackVersion : v.version;
      return { type: 'verified', staged: { stagedPath: v.stagedPath, sha256: v.sha256, version } };
    }
    case 'verifyFailed': {
      if (!isApp(kind.value.component)) return null;
      const retry = METADATA_REASONS.has(kind.value.reason) ? 'check' : 'download';
      return downloadFailed({ key: verifyReasonKey(kind.value.reason), detail: '' }, retry);
    }
    case 'failed': {
      if (!isApp(kind.value.component)) return null;
      const retry = kind.value.recoverable ? 'download' : 'check';
      return downloadFailed({ key: 'upd.dlFailed', detail: kind.value.message }, retry);
    }
    default:
      return null;
  }
}

/** Итог повторной проверки перед установкой (стрим ApplyUpdates). */
export type ApplySignal =
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly error: ErrorInfo; readonly retry: 'install' | 'download' };

/** Сигнал по событию установки; `null` — промежуточное событие. */
export function applySignal(ev: UpdateEvent): ApplySignal | null {
  const { kind } = ev;
  switch (kind.case) {
    case 'readyForRestart':
      return { kind: 'ready' };
    case 'verifyFailed':
      // Копия в staging изменилась или забракована: ставить нечего, нужна новая загрузка.
      return { kind: 'failed', error: { key: verifyReasonKey(kind.value.reason), detail: '' }, retry: 'download' };
    case 'failed':
      return {
        kind: 'failed',
        error: { key: 'upd.err.generic', detail: kind.value.message },
        retry: kind.value.recoverable ? 'install' : 'download',
      };
    default:
      return null;
  }
}
