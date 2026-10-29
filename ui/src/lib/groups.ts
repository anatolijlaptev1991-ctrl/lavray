// SPDX-License-Identifier: GPL-3.0-only

// groups.ts — правила работы с группами серверов, общие для экранов и диалогов.
import { Group_Kind } from '../gen/lavray_pb';
import type { MessageKey } from './i18n';

/** Значение фильтра «Добавлены вручную» (#subSel на экране «Серверы»). */
export const MANUAL_FILTER = 'manual';

/** Встроенная группа «Default» из миграции ядра (store.DefaultGroupID). Ядро не меняем. */
export const DEFAULT_GROUP_ID = 2147483000n;

/** Что нужно знать о группе для выбора: id и вид (подписка или нет). */
export interface GroupRef {
  readonly id: bigint;
  readonly kind: Group_Kind;
}

/** id группы из значения фильтра; null для «all», «manual» и пустой строки. */
export function numericGroupId(filter: string): bigint | null {
  return /^\d+$/.test(filter) ? BigInt(filter) : null;
}

/**
 * Группа для сервера, создаваемого в редакторе «Добавить».
 * - «Добавлены вручную» — первая группа списка, не являющаяся подпиской:
 *   ручной сервер внутри подписки сотрёт следующее обновление;
 * - вкладка или фильтр с конкретной группой — эта группа;
 * - иначе — группа по умолчанию (targetGroup).
 * «0» и пустая строка означают «группы нет»: возвращается null, а кнопка
 * «Добавить» неактивна (ядро на group_id=0 отвечает invalid_argument).
 */
export function newServerGroupId(
  filter: string,
  targetGroup: string,
  groups: readonly GroupRef[],
): bigint | null {
  if (filter === MANUAL_FILTER) {
    return groups.find((g) => g.kind !== Group_Kind.SUBSCRIPTION)?.id ?? null;
  }
  const id = numericGroupId(filter) ?? (targetGroup === '' ? null : BigInt(targetGroup));
  return id === null || id === 0n ? null : id;
}

/**
 * Группа для импорта (диалог «Импорт»). undefined — группу не передаём, ядро
 * кладёт серверы в «Default» (T-07).
 * - «Добавлены вручную» — как у редактора: первая НЕ подписочная группа,
 *   иначе импорт при этом фильтре попадал бы в подписку из начала списка;
 * - вкладка или фильтр с конкретной группой — эта группа, иначе targetGroup;
 * - «0» и пустая строка — группы нет.
 */
export function importGroupId(
  filter: string,
  targetGroup: string,
  groups: readonly GroupRef[],
): bigint | undefined {
  if (filter === MANUAL_FILTER) {
    return newServerGroupId(filter, targetGroup, groups) ?? undefined;
  }
  const raw = numericGroupId(filter) !== null ? filter : targetGroup;
  return raw === '' || raw === '0' ? undefined : BigInt(raw);
}

/**
 * Имя группы для показа. Встроенная «Default» (DEFAULT_GROUP_ID) показывается
 * переводом grp.default, пока пользователь не переименовал её; любое другое
 * имя показывается как есть. Ядро не меняется: имя в нём остаётся «Default».
 */
export function groupDisplayName(
  group: { readonly id: bigint; readonly name: string },
  t: (key: MessageKey) => string,
): string {
  return group.id === DEFAULT_GROUP_ID && group.name === 'Default' ? t('grp.default') : group.name;
}
