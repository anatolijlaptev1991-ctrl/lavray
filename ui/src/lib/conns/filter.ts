// SPDX-License-Identifier: GPL-3.0-only

// filter.ts — чипы «Все / Прокси / Напрямую / Блок» и поиск по соединениям (T-79).
// Чистые функции без React: экран и тесты берут их отсюда.
//
// Соответствие чипам определяется ПОСЛЕДНИМ исходящим цепочки (куда трафик
// действительно ушёл), а не первым (его выбрало правило: это может быть группа):
//  - «Блок»      — статус BLOCKED либо итоговый исходящий `block`;
//  - «Напрямую»  — итоговый исходящий `direct` или `bypass` (так ядро называет
//                  прямой выход по правилам «напрямую»);
//  - «Прокси»    — всё остальное.
import { Connection_Status } from '../../gen/lavray_pb';
import type { Connection } from '../../gen/lavray_pb';

export type ConnChip = 'all' | 'proxy' | 'direct' | 'block';
export type ConnKind = Exclude<ConnChip, 'all'>;

export const CONN_CHIPS: readonly ConnChip[] = ['all', 'proxy', 'direct', 'block'];

const DIRECT_TAGS: ReadonlySet<string> = new Set(['direct', 'bypass']);
const BLOCK_TAG = 'block';

/** Итоговый исходящий: последний в цепочке, а без цепочки — `outbound`. */
export function finalOutbound(c: Connection): string {
  const last = c.chain.at(-1);
  return last === undefined || last === '' ? c.outbound : last;
}

export function kindOf(c: Connection): ConnKind {
  const final = finalOutbound(c);
  if (c.status === Connection_Status.BLOCKED || final === BLOCK_TAG || c.outbound === BLOCK_TAG) {
    return 'block';
  }
  return DIRECT_TAGS.has(final) ? 'direct' : 'proxy';
}

export function matchesChip(c: Connection, chip: ConnChip): boolean {
  return chip === 'all' || kindOf(c) === chip;
}

/** `needle` — уже обрезанная строка в нижнем регистре; пустая подходит всем. */
export function matchesQuery(c: Connection, needle: string): boolean {
  if (needle === '') return true;
  const fields = [c.destination, c.resolvedDestination, c.outbound, c.chain.join(' '), c.rule, c.process];
  return fields.some((f) => f?.toLowerCase().includes(needle) === true);
}

/** Отбирает соединения по чипу и подстроке (без учёта регистра); порядок сохраняется. */
export function filterConns(
  list: readonly Connection[],
  chip: ConnChip,
  query: string,
): readonly Connection[] {
  const needle = query.trim().toLowerCase();
  if (chip === 'all' && needle === '') return list;
  return list.filter((c) => matchesChip(c, chip) && matchesQuery(c, needle));
}
