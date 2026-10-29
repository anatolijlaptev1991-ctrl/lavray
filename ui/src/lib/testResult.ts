// SPDX-License-Identifier: GPL-3.0-only

// testResult.ts — разбор результата теста задержки, пришедшего от ядра, и
// подписи к нему: колонка результата и отчёт полного теста.
import { formatMs, formatSpeed } from './i18n';
import type { Language, MessageKey } from './i18n';

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

/** Результат теста в объёме, нужном колонке: задержка и ошибка. */
export interface ResultLike {
  readonly latencyMs?: number | undefined;
  readonly lastError?: string | undefined;
}

/** Главная подпись колонки: «н/д», ✕ у недоступного, задержка либо «—». */
export function resultLabel(
  r: ResultLike | undefined,
  t: (key: MessageKey) => string,
  lang: Language,
): string {
  if (isTestNotApplicable(r)) return t('test.na');
  if (isTestDown(r)) return '✕';
  const ms = r?.latencyMs;
  return ms !== undefined && ms > 0 ? formatMs(ms, lang) : '—';
}

/** Поля FullTestReport, которые показывает колонка. */
export interface FullReportLike {
  readonly latencyMs?: number | undefined;
  readonly udpLatencyMs?: number | undefined;
  /** Скорость скачивания в бит/с (контракт ядра). */
  readonly downloadBps?: number | undefined;
  readonly ingressIp?: string | undefined;
  readonly egressIp?: string | undefined;
  readonly error?: string | undefined;
}

/**
 * Строка отчёта полного теста: «Задержка: 120 мс; UDP: 45 мс; Скорость: 3,2 МБ/с;
 * Вход: 203.0.113.5; Выход: 198.51.100.7». Нет отчёта или в нём нечего показать —
 * пустая строка. Ошибка частичного отказа добавляется в конец как есть.
 */
export function formatFullReport(
  rep: FullReportLike | undefined,
  t: (key: MessageKey) => string,
  lang: Language,
): string {
  if (rep === undefined) return '';
  const parts: string[] = [];
  if (rep.latencyMs !== undefined && rep.latencyMs > 0) {
    parts.push(`${t('test.latency')}: ${formatMs(rep.latencyMs, lang)}`);
  }
  if (rep.udpLatencyMs !== undefined && rep.udpLatencyMs > 0) {
    parts.push(`${t('test.rep.udp')}: ${formatMs(rep.udpLatencyMs, lang)}`);
  }
  if (rep.downloadBps !== undefined && rep.downloadBps > 0) {
    parts.push(`${t('test.rep.speed')}: ${formatSpeed(rep.downloadBps / 8, lang)}`);
  }
  if (rep.ingressIp !== undefined && rep.ingressIp !== '') parts.push(`${t('test.rep.in')}: ${rep.ingressIp}`);
  if (rep.egressIp !== undefined && rep.egressIp !== '') parts.push(`${t('test.rep.out')}: ${rep.egressIp}`);
  if (rep.error !== undefined && rep.error !== '') parts.push(rep.error);
  return parts.join('; ');
}
