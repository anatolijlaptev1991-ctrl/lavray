// SPDX-License-Identifier: GPL-3.0-only

// presetDraft.ts — правка набора маршрутов как чистые функции (T-80): патч
// поверх набора ↔ сообщение для UpdatePreset, признак «изменено» (пустую
// правку в ядро не шлём), добавление и удаление записей списка, разбор имён
// процессов. Ядро проверяет то же самое и отвечает INVALID_ARGUMENT, но
// клиент показывает причину сразу в поле.
import { create, equals } from '@bufbuild/protobuf';
import { Outbound, ProcessRuleSchema, RoutingPresetSchema } from '../gen/lavray_pb';
import type { ProcessRule, RoutingPreset } from '../gen/lavray_pb';
import type { MessageKey } from './i18n';

export type ListKind = 'proxyDomain' | 'directDomain' | 'blockDomain' | 'proxyIp' | 'directIp' | 'blockIp';

/** Выходы набора для выпадающих списков. */
export const OUTBOUND_OPTIONS: readonly { readonly value: Outbound; readonly labelKey: MessageKey }[] = [
  { value: Outbound.PROXY, labelKey: 'out.proxy' },
  { value: Outbound.DIRECT, labelKey: 'out.direct' },
  { value: Outbound.BLOCK, labelKey: 'out.block' },
];

/** Предел имён процессов в одном правиле и длины имени набора (как в ядре). */
export const MAX_PROCESS_NAMES = 64;
export const MAX_NAME_LENGTH = 64;

/** Что меняет одна операция: имя, выход по умолчанию, списки, правила процессов. */
export interface PresetPatch {
  readonly displayName?: string;
  readonly defaultOutbound?: Outbound;
  readonly lists?: Partial<Record<ListKind, readonly string[]>>;
  readonly processRules?: readonly ProcessRule[];
}

/** Набор с применённой правкой; исходный не меняется. */
export function applyPatch(base: RoutingPreset, patch: PresetPatch): RoutingPreset {
  const lists = Object.fromEntries(Object.entries(patch.lists ?? {}).map(([k, v]) => [k, [...v]]));
  return create(RoutingPresetSchema, {
    ...base,
    ...lists,
    ...(patch.displayName === undefined ? {} : { displayName: patch.displayName.trim() }),
    ...(patch.defaultOutbound === undefined ? {} : { defaultOutbound: patch.defaultOutbound }),
    ...(patch.processRules === undefined ? {} : { processRules: [...patch.processRules] }),
  });
}

/** Отличается ли правка от набора (источник, ревизия и признаки ядра не сравниваются). */
export function isChanged(base: RoutingPreset, next: RoutingPreset): boolean {
  const strip = (p: RoutingPreset): RoutingPreset =>
    create(RoutingPresetSchema, { ...p, revision: 0, builtinSourceId: '', builtinSourceRevision: 0, sourceUpdated: false });
  return !equals(RoutingPresetSchema, strip(base), strip(next));
}

export type AddResult =
  | { readonly kind: 'added'; readonly list: string[] }
  | { readonly kind: 'exists' }
  | { readonly kind: 'empty' };

/** Добавить запись в конец списка; повтор (без учёта регистра) и пустая строка ничего не меняют. */
export function addEntry(list: readonly string[], raw: string): AddResult {
  const entry = raw.trim();
  if (entry === '') return { kind: 'empty' };
  if (list.some((x) => x.toLowerCase() === entry.toLowerCase())) return { kind: 'exists' };
  return { kind: 'added', list: [...list, entry] };
}

export const removeEntry = (list: readonly string[], entry: string): string[] => list.filter((x) => x !== entry);

export type ProcessNames =
  | { readonly ok: true; readonly names: string[] }
  | { readonly ok: false; readonly reason: 'empty' | 'path' | 'many'; readonly bad?: string };

/** Имена процессов из строки (запятая, точка с запятой, пробел, перевод строки): только имена, без путей. */
export function parseProcessNames(raw: string): ProcessNames {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of raw.split(/[\s,;]+/).filter((s) => s !== '')) {
    if (/[\\/]/.test(name) || name.includes('..')) return { ok: false, reason: 'path', bad: name };
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      names.push(name);
    }
  }
  if (names.length === 0) return { ok: false, reason: 'empty' };
  if (names.length > MAX_PROCESS_NAMES) return { ok: false, reason: 'many' };
  return { ok: true, names };
}

/** Новое правило процессов; имена *.exe действуют только в Windows (SCHEMA §2.1). */
export function newProcessRule(names: readonly string[], outbound: Outbound): ProcessRule {
  const windowsOnly = names.every((n) => n.toLowerCase().endsWith('.exe'));
  return create(ProcessRuleSchema, { processNames: [...names], outbound, platforms: windowsOnly ? ['windows'] : [] });
}
