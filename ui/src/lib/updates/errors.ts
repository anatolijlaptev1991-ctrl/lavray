// SPDX-License-Identifier: GPL-3.0-only

// errors.ts — разбор ошибок подсистемы обновлений (T-75): ошибка ядра →
// «что показать» (ключ словаря), код оболочки → ключ словаря. Состояние хранит
// ключ, а не готовый текст, поэтому смена языка перевод не теряет.
import { Code, ConnectError } from '@connectrpc/connect';
import type { MessageKey } from '../i18n';

/** Причины FAILED_PRECONDITION: ядро кладёт их в начало сообщения («<причина>: …»). */
const REASONS = [
  'not_configured',
  'bad_signature',
  'expired',
  'serial_rollback',
  'wrong_product',
  'wrong_channel',
  'root_rotation',
  'artifact_role_missing',
  'clock_skew',
  'active_session',
] as const;

export type UpdateReason = (typeof REASONS)[number];

const REASON_PREFIX = new RegExp(`^(${REASONS.join('|')}):\\s*([\\s\\S]*)$`);

export interface ParsedReason {
  /** Известная причина или `null`, если префикса нет / он незнакомый. */
  readonly reason: UpdateReason | null;
  /** Текст после причины; без причины — сообщение целиком. */
  readonly detail: string;
}

/** Разбирает сообщение вида `<причина>: <текст>`. */
export function parseReason(message: string): ParsedReason {
  const m = REASON_PREFIX.exec(message.trim());
  if (m === null) return { reason: null, detail: message.trim() };
  return { reason: m[1] as UpdateReason, detail: (m[2] ?? '').trim() };
}

/** Тексты отказов проверки (события verify_failed и FAILED_PRECONDITION). */
const REASON_KEYS: Readonly<Record<string, MessageKey>> = {
  not_configured: 'upd.notConfigured',
  bad_signature: 'upd.reason.bad_signature',
  expired: 'upd.reason.expired',
  serial_rollback: 'upd.reason.serial_rollback',
  wrong_product: 'upd.reason.wrong_product',
  wrong_channel: 'upd.reason.wrong_channel',
  root_rotation: 'upd.reason.root_rotation',
  artifact_role_missing: 'upd.reason.artifact_role_missing',
  clock_skew: 'upd.reason.clock_skew',
  sha256_mismatch: 'upd.reason.sha256_mismatch',
  truncated: 'upd.reason.truncated',
};

/** Ключ текста для причины события `verify_failed`; незнакомая причина — общий текст. */
export function verifyReasonKey(reason: string): MessageKey {
  return Object.hasOwn(REASON_KEYS, reason) ? (REASON_KEYS[reason] ?? 'upd.reason.generic') : 'upd.reason.generic';
}

/** Что делать с ошибкой: от неё зависит состояние экрана. */
export type FailureKind = 'network' | 'notConfigured' | 'activeSession' | 'running' | 'error';

export interface Failure {
  readonly kind: FailureKind;
  /** Ключ понятного текста. */
  readonly key: MessageKey;
  /** Сырой текст ядра (показывается мелко, как обычный текст), может быть пустым. */
  readonly detail: string;
}

// Сбой самого транспорта: ядро не ответило. Это «проверка не удалась», а не «нет обновлений».
const TRANSPORT_DOWN = /(Failed to fetch|NetworkError|fetch failed|Load failed)/i;

function isNetwork(err: ConnectError): boolean {
  return err.code === Code.Unavailable || err.code === Code.DeadlineExceeded || TRANSPORT_DOWN.test(err.rawMessage);
}

/** Классифицирует ошибку RPC обновлений (CheckUpdates / DownloadUpdates / ApplyUpdates). */
export function classifyCoreError(e: unknown): Failure {
  if (e === null || e === undefined || (typeof e !== 'object' && typeof e !== 'string')) {
    return { kind: 'error', key: 'upd.err.generic', detail: '' };
  }
  const err = ConnectError.from(e);
  if (isNetwork(err)) return { kind: 'network', key: 'upd.checkFailed', detail: '' };
  if (err.code === Code.Aborted) return { kind: 'running', key: 'upd.dlRunning', detail: '' };
  if (err.code === Code.FailedPrecondition) return classifyPrecondition(err.rawMessage);
  return { kind: 'error', key: 'upd.err.generic', detail: '' };
}

function classifyPrecondition(message: string): Failure {
  const { reason, detail } = parseReason(message);
  if (reason === 'not_configured') return { kind: 'notConfigured', key: 'upd.notConfigured', detail };
  if (reason === 'active_session') return { kind: 'activeSession', key: 'upd.sessionD', detail };
  if (reason === null) return { kind: 'error', key: 'upd.reason.generic', detail };
  return { kind: 'error', key: verifyReasonKey(reason), detail };
}

/** Коды ошибок команд оболочки → тексты. Таблица явная: ключи видны проверке словарей. */
const SHELL_KEYS: Readonly<Record<string, MessageKey>> = {
  busy: 'upd.err.busy',
  path_outside_staging: 'upd.err.path_outside_staging',
  sha256_mismatch: 'upd.err.sha256_mismatch',
  locked: 'upd.err.locked',
  core_stop_failed: 'upd.err.core_stop_failed',
  launch_failed: 'upd.err.launch_failed',
  invalid_sha256: 'upd.err.invalid_sha256',
  proxy_release_failed: 'upd.err.proxy_release_failed',
  prepare_failed: 'upd.err.prepare_failed',
  invalid_version: 'upd.err.invalid_version',
  rollback_unavailable: 'upd.err.rollback_unavailable',
  invalid_source: 'upd.err.invalid_source',
  too_large: 'upd.err.too_large',
  stage_failed: 'upd.err.stage_failed',
  signature_invalid: 'upd.err.signature_invalid',
  version_mismatch: 'upd.err.version_mismatch',
  core_unavailable: 'upd.err.core_unavailable',
  no_shell: 'upd.err.no_shell',
};

/** Стабильный код из отказа Tauri: оболочка отдаёт строку из `Err(String)`. */
export function shellErrorCode(e: unknown): string {
  if (typeof e === 'string') return e.trim();
  return e instanceof Error ? e.message.trim() : '';
}

/** Ключ текста для ошибки команды оболочки; неизвестный код — общий текст. */
export function shellErrorKey(e: unknown): MessageKey {
  const code = shellErrorCode(e);
  return Object.hasOwn(SHELL_KEYS, code) ? (SHELL_KEYS[code] ?? 'upd.err.generic') : 'upd.err.generic';
}

/** Отказы, после которых копия в staging негодна: повтор возможен только через новую загрузку. */
const STAGED_REJECTED: ReadonlySet<string> = new Set([
  'sha256_mismatch',
  'path_outside_staging',
  'invalid_sha256',
  'invalid_version',
  'signature_invalid',
  'version_mismatch',
]);

/** Что повторять после отказа оболочки: установку или загрузку заново. */
export function shellRetryTarget(e: unknown): 'install' | 'download' {
  return STAGED_REJECTED.has(shellErrorCode(e)) ? 'download' : 'install';
}
