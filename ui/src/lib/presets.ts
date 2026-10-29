// presets.ts — названия и описания пресетов маршрутов через словарь.
// Для встроенного пресета ядро отдаёт displayName ключом локализации
// («preset.lav-ru», core/internal/api/convert.go: presetToProto), для своего —
// готовым именем. Идентификаторы встроенных — файлы core/internal/presets/builtin.
import type { RoutingPreset } from '../gen/lavray_pb';
import type { MessageKey } from './i18n';

interface Builtin {
  /** Название-бренд, не переводится (прототип: name:'LAV Preset RU'). */
  readonly name?: string;
  readonly nameKey?: MessageKey;
  readonly descKey: MessageKey;
}

const BUILTIN: Readonly<Record<string, Builtin>> = {
  'lav-ru': { name: 'LAV Preset RU', descKey: 'preset.lavru.desc' },
  'lav-cn': { name: 'LAV Preset CN', descKey: 'preset.lavcn.desc' },
  global: { nameKey: 'preset.global.t', descKey: 'preset.global.d' },
  'all-proxy': { nameKey: 'preset.allproxy.t', descKey: 'preset.allproxy.d' },
  'all-direct': { nameKey: 'preset.alldirect.t', descKey: 'preset.alldirect.d' },
};

/** Название пресета для показа: встроенный — по словарю, свой — имя как есть. */
export function presetTitle(
  id: string,
  displayName: string,
  t: (key: MessageKey) => string,
): string {
  const known = BUILTIN[id];
  if (known?.nameKey !== undefined) return t(known.nameKey);
  if (known?.name !== undefined) return known.name;
  // Встроенный пресет, которого UI ещё не знает: сырой ключ не показываем.
  return displayName.startsWith('preset.') ? id : displayName;
}

/** Описание встроенного пресета; у своего и неизвестного — null. */
export function presetDescription(id: string, t: (key: MessageKey) => string): string | null {
  const known = BUILTIN[id];
  return known === undefined ? null : t(known.descKey);
}

/** Число правил пресета: записи всех списков и процессные правила. */
export function presetRuleCount(p: RoutingPreset): number {
  return (
    p.proxyDomain.length +
    p.directDomain.length +
    p.blockDomain.length +
    p.proxyIp.length +
    p.directIp.length +
    p.blockIp.length +
    p.processRules.length
  );
}
