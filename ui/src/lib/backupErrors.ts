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
import type { MessageKey } from './i18n';

const ERROR_INFO_TYPE = 'google.rpc.ErrorInfo';
// Домен ErrorInfo ядра, не ключ localStorage: шаблонная строка, чтобы проверка
// списка общих ключей UI (shell/src/ui_state/tests.rs) её не путала с ключом.
const ERROR_DOMAIN = `lavray.core`;

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

function readVarint(buf: Uint8Array, at: number): [value: number, next: number] | null {
  let value = 0;
  for (let i = 0, shift = 0; i < 5 && at + i < buf.length; i++, shift += 7) {
    const byte = buf[at + i] ?? 0;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, at + i + 1];
  }
  return null;
}

/** Поля reason (1) и domain (2) сообщения google.rpc.ErrorInfo; остальные пропускаются. */
export function decodeErrorInfo(buf: Uint8Array): { reason: string; domain: string } {
  const out = { reason: '', domain: '' };
  const text = new TextDecoder();
  let at = 0;
  while (at < buf.length) {
    const tag = readVarint(buf, at);
    if (tag === null) break;
    const [key, afterTag] = tag;
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (wire !== 2) break; // в ErrorInfo все поля — строки и map: длина + байты
    const len = readVarint(buf, afterTag);
    if (len === null || len[1] + len[0] > buf.length) break;
    const bytes = buf.subarray(len[1], len[1] + len[0]);
    if (field === 1) out.reason = text.decode(bytes);
    if (field === 2) out.domain = text.decode(bytes);
    at = len[1] + len[0];
  }
  return out;
}

/** Причина (ErrorInfo.reason) ошибки ядра; null — ошибка не от ядра или без причины. */
export function errorReason(e: unknown): string | null {
  if (!(e instanceof ConnectError)) return null;
  for (const d of e.details) {
    if (!('type' in d) || d.type !== ERROR_INFO_TYPE) continue;
    const info = decodeErrorInfo(d.value);
    if (info.domain === ERROR_DOMAIN && info.reason !== '') return info.reason;
  }
  return null;
}

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
