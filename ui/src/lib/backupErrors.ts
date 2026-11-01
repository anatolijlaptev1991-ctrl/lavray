// SPDX-License-Identifier: GPL-3.0-only

/**
 * Ошибки BackupService (T-83) → ключи словаря. Ядро отвечает кодом Connect и
 * причиной в детали ErrorInfo { domain: "lavray.core", reason }; текст
 * сообщения для выбора фразы не используется. Деталь приходит как
 * google.protobuf.Any, а схемы google.rpc.ErrorInfo в сгенерированном коде UI
 * нет, поэтому два нужных строковых поля читаются из проволочного формата.
 */
import { Code, ConnectError } from '@connectrpc/connect';
import { showCoreError, type CoreErrorTranslate } from './core';
import { errorReason } from './errorInfo';
import type { MessageKey } from './i18n';

/** Причины, которые ядро кладёт в ErrorInfo.reason. */
const REASON_KEYS: Readonly<Record<string, MessageKey>> = {
  password_too_short: 'bk.err.pwShort',
  password_too_long: 'bk.err.pwLong',
  backup_not_recognized: 'bk.err.notRecognized',
  backup_wrong_password: 'bk.err.wrongPassword',
  backup_tampered: 'bk.err.tampered',
  backup_from_newer_version: 'bk.err.newer',
  confirm_replace_required: 'bk.err.confirm',
  connection_active: 'bk.err.connected',
  backup_too_large: 'bk.err.tooLarge',
  backup_busy: 'bk.err.busy',
  backup_failed: 'bk.err.failed',
};

/** Запасной ключ по коду, если причины в ответе нет (например, лимит транспорта). */
const CODE_KEYS: Readonly<Partial<Record<Code, MessageKey>>> = {
  [Code.PermissionDenied]: 'bk.err.wrongPassword',
  [Code.DataLoss]: 'bk.err.tampered',
  [Code.ResourceExhausted]: 'bk.err.tooLarge',
  [Code.Aborted]: 'bk.err.busy',
};

// Разбор ErrorInfo живёт в errorInfo.ts (его нужен и общему разбору ошибок core.ts);
// здесь он доступен под прежними именами.
export { decodeErrorInfo, errorReason } from './errorInfo';

/** Ключ словаря для ошибки копии; null — ошибка не относится к копии. */
export function backupErrorKey(e: unknown): MessageKey | null {
  const reason = errorReason(e);
  if (reason !== null) return REASON_KEYS[reason] ?? null;
  return e instanceof ConnectError ? (CODE_KEYS[e.code] ?? null) : null;
}

/** Текст ошибки копии на языке интерфейса; прочие ошибки — общий разбор ядра. */
export function backupErrorText(e: unknown, t: CoreErrorTranslate & ((key: MessageKey) => string)): string {
  const key = backupErrorKey(e);
  return key === null ? showCoreError(e, t) : t(key);
}
