// SPDX-License-Identifier: GPL-3.0-only

// nekoBox.ts — чистая логика переноса из NekoBox (T-78): строка с числами для
// плитки онбординга и отчёта, перевод ошибок MigrationService.
import { Code, ConnectError } from '@connectrpc/connect';
import type { NekoBoxCandidate, NekoBoxReport } from '../gen/lavray_pb';
import { friendlyCoreError } from './core';
import { pluralN, tf, type Language, type MessageKey } from './i18n';

/** Сколько профилей в отчёте (сумма по типам). */
export function profilesTotal(report: NekoBoxReport): number {
  return Object.values(report.profilesByType).reduce((sum, n) => sum + n, 0);
}

/** «32 сервера, 2 группы, 3 маршрута» — числа, склонённые по языку. */
export function countsLine(servers: number, groups: number, routes: number, lang?: Language): string {
  return [pluralN('pl.srv', servers, lang), pluralN('pl.grp', groups, lang), pluralN('pl.rt', routes, lang)].join(', ');
}

/** Подпись плитки онбординга: «Найдено: …» по первой установке (key onb.neko.found). */
export function foundText(c: NekoBoxCandidate, lang?: Language): string {
  return tf(
    'onb.neko.found',
    {
      servers: pluralN('pl.srv', c.profiles, lang),
      groups: pluralN('pl.grp', c.groups, lang),
      routes: pluralN('pl.rt', c.routes, lang),
    },
    lang,
  );
}

/** Итог переноса: «Перенесено: …» (key onb.neko.report). */
export function reportText(r: NekoBoxReport, lang?: Language): string {
  return tf(
    'onb.neko.report',
    {
      servers: pluralN('pl.srv', profilesTotal(r), lang),
      groups: pluralN('pl.grp', r.groupsImported, lang),
      routes: pluralN('pl.rt', r.routesImported, lang),
    },
    lang,
  );
}

const CODE_KEYS: Readonly<Partial<Record<Code, MessageKey>>> = {
  [Code.InvalidArgument]: 'nb.err.invalid',
  [Code.NotFound]: 'nb.err.notFound',
  [Code.ResourceExhausted]: 'nb.err.limits',
  [Code.Aborted]: 'nb.err.busy',
};

/**
 * Текст ошибки MigrationService по коду Connect. Недоступное ядро получает
 * общий текст «ядро недоступно»; остальное — «не удалось выполнить перенос».
 */
export function nekoBoxErrorText(e: unknown, tr: (key: MessageKey) => string): string {
  if (e instanceof ConnectError) {
    const key = CODE_KEYS[e.code];
    if (key !== undefined) return tr(key);
  }
  const friendly = friendlyCoreError(e, (k) => tr(k));
  return friendly === tr('core.unavailable') ? friendly : tr('nb.err.generic');
}
