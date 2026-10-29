// SPDX-License-Identifier: GPL-3.0-only

// testResult.ts — разбор результата теста задержки, пришедшего от ядра.

/**
 * Код в TestResult.last_error: тест к этому профилю не применим (например,
 * TCP-пинг для Hysteria2/TUIC, которые работают по UDP/QUIC). Это не «сервер
 * недоступен». Контракт с ядром: core/internal/api/test_service.go,
 * константа testNAPrefix.
 */
export const TEST_NA_PREFIX = 'n/a: ';

/** Тест не применим к профилю — показывать «н/д», а не ✕. */
export function isTestNotApplicable(r: { readonly lastError?: string | undefined } | undefined): boolean {
  return (r?.lastError ?? '').startsWith(TEST_NA_PREFIX);
}

/** Сервер недоступен: тест выполнен и закончился ошибкой. */
export function isTestDown(r: { readonly lastError?: string | undefined } | undefined): boolean {
  return (r?.lastError ?? '') !== '' && !isTestNotApplicable(r);
}
