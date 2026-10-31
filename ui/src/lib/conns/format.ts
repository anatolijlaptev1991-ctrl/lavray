// SPDX-License-Identifier: GPL-3.0-only

// format.ts — подготовка полей соединения к показу (T-79). Сами форматтеры
// объёма и длительности общие: formatBytes/formatDuration из lib/i18n (языковые
// единицы и цифры); здесь только то, что специфично для соединений.
import type { Connection } from '../../gen/lavray_pb';
import { formatBytes, formatDuration } from '../i18n';
import type { Language } from '../i18n';

/** Разделитель звеньев цепочки: по ходу трафика слева направо. */
export const CHAIN_SEPARATOR = ' → ';

/** int64 из protobuf → число для показа (отрицательные и огромные значения не ломают формат). */
export function bytesOf(value: bigint): number {
  return value < 0n ? 0 : Number(value);
}

export function formatConnBytes(value: bigint, lang: Language): string {
  return formatBytes(bytesOf(value), lang);
}

/** Длительность в мс: у закрытых — до `endedAtMs`, у активных — до `nowMs`. */
export function connDurationMs(c: Connection, nowMs: number): number {
  const end = c.endedAtMs === undefined ? nowMs : Number(c.endedAtMs);
  return Math.max(0, end - Number(c.startedAtMs));
}

export function formatConnDuration(c: Connection, nowMs: number, lang: Language): string {
  return formatDuration(connDurationMs(c, nowMs), lang);
}

/** «выбрано правилом → … → итоговый»; без цепочки (старое ядро) — просто `outbound`. */
export function chainText(c: Connection): string {
  return c.chain.length > 0 ? c.chain.join(CHAIN_SEPARATOR) : c.outbound;
}
