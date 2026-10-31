// SPDX-License-Identifier: GPL-3.0-only

// webSession.ts — логика веб-панели без React (T-76): признак веб-режима,
// CSRF-токен сессии, проверка пароля на клиенте, разбор ошибок входа.
// Пароль в памяти не хранится: страница держит только CSRF-токен.
import { Code, ConnectError } from '@connectrpc/connect';
import type { MessageKey } from './i18n';

/** Не короче стольких символов — та же политика, что в ядре (web/users.go). */
export const MIN_PASSWORD_LENGTH = 10;

/** Сообщение для пользователя: ключ словаря (с параметрами) либо готовый текст ядра. */
export type WebMessage =
  | { readonly key: MessageKey; readonly params?: Readonly<Record<string, string | number>> }
  | { readonly text: string };

let csrfToken = '';

/** CSRF-токен текущей сессии ('' — сессии нет). */
export const getCsrfToken = (): string => csrfToken;

export const setCsrfToken = (value: string): void => {
  csrfToken = value;
};

interface ShellWindow {
  __TAURI_INTERNALS__?: unknown;
  __LAVRAY_CORE_URL?: string;
  __LAVRAY_CORE_TOKEN?: string;
}

/**
 * Страница открыта обычным браузером у ядра с веб-панелью: не окно Tauri и не
 * подмена адреса ядра (dev-режим, тесты). Только тогда нужен вход по паролю и
 * клиенты работают в режиме cookie.
 */
export function isWebShell(win: Window = window): boolean {
  const w = win as unknown as ShellWindow;
  return (
    w.__TAURI_INTERNALS__ === undefined &&
    w.__LAVRAY_CORE_URL === undefined &&
    w.__LAVRAY_CORE_TOKEN === undefined &&
    win.location.protocol.startsWith('http')
  );
}

/** localhost, 127.0.0.0/8, ::1 — трафик не покидает компьютер. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

/** HTTP не на loopback: пароль и cookie идут открытым текстом («Не защищено»). */
export function isInsecureTransport(
  loc: Pick<Location, 'protocol' | 'hostname'> = window.location,
): boolean {
  return loc.protocol === 'http:' && !isLoopbackHost(loc.hostname);
}

/** Пауза до повтора из заголовка Retry-After ответа RESOURCE_EXHAUSTED (секунды). */
export function retryAfterSeconds(e: unknown): number | null {
  if (!(e instanceof ConnectError) || e.code !== Code.ResourceExhausted) return null;
  const n = Number(e.metadata.get('retry-after'));
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 30;
}

/** Проверка нового пароля на клиенте (ядро проверяет ту же политику повторно). */
export function passwordProblem(password: string, confirm?: string): WebMessage | null {
  if (Array.from(password).length < MIN_PASSWORD_LENGTH) {
    return { key: 'web.setup.short', params: { n: MIN_PASSWORD_LENGTH } };
  }
  if (confirm !== undefined && confirm !== password) return { key: 'web.setup.mismatch' };
  return null;
}

/** Ошибка входа или первичной настройки → сообщение (общий текст без подсказок об учётной записи). */
export function authFailure(e: unknown, fallback: (e: unknown) => string): WebMessage {
  const wait = retryAfterSeconds(e);
  if (wait !== null) return { key: 'web.login.wait', params: { n: wait } };
  if (e instanceof ConnectError && e.code === Code.Unauthenticated) return { key: 'web.login.badCreds' };
  if (e instanceof ConnectError && e.code === Code.InvalidArgument) {
    return { key: 'web.setup.short', params: { n: MIN_PASSWORD_LENGTH } };
  }
  return { text: fallback(e) };
}
