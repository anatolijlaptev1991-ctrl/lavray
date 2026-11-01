// SPDX-License-Identifier: GPL-3.0-only

// settingValues.ts — значения настроек ядра (SettingValue) ↔ простые значения
// интерфейса. Общие для экрана «Настройки» и потока изменений (useSettingsSync).
import { create } from '@bufbuild/protobuf';
import { SettingType, SettingValueSchema } from '../gen/lavray_pb';
import type { SettingValue } from '../gen/lavray_pb';

export function valueOf(v: SettingValue | undefined): string | boolean | number {
  const c = v?.value;
  if (c === undefined) return '';
  switch (c.case) {
    case 'stringValue':
      return c.value;
    case 'boolValue':
      return c.value;
    case 'intValue':
      return Number(c.value);
    case 'doubleValue':
      return c.value;
    case 'stringListValue':
      return c.value.items.join('\n');
    case 'jsonValue':
      return c.value;
    default:
      return '';
  }
}

/** Значения из GetSettings в виде, с которым работает экран. */
export function valuesOf(settings: Readonly<Record<string, SettingValue>>): Record<string, string | boolean | number> {
  const map: Record<string, string | boolean | number> = {};
  for (const [k, v] of Object.entries(settings)) map[k] = valueOf(v);
  return map;
}

/** Целое число из ввода; пустое поле и нечисло → null (раньше становились 0). */
export function parseInteger(raw: string | boolean | number): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null;
  const text = String(raw).trim();
  return /^-?\d+$/.test(text) ? Number(text) : null;
}

export function toSettingValue(kind: SettingType, raw: string | boolean | number): SettingValue {
  switch (kind) {
    case SettingType.BOOL:
      return create(SettingValueSchema, {
        value: { case: 'boolValue', value: raw === true || raw === 'true' },
      });
    case SettingType.INT: {
      const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
      return create(SettingValueSchema, {
        value: { case: 'intValue', value: BigInt(Number.isFinite(n) ? n : 0) },
      });
    }
    case SettingType.STRING_LIST:
      return create(SettingValueSchema, {
        value: {
          case: 'stringListValue',
          value: { items: String(raw).split('\n').filter((s) => s.trim() !== '') },
        },
      });
    case SettingType.JSON:
      return create(SettingValueSchema, { value: { case: 'jsonValue', value: String(raw) } });
    default:
      return create(SettingValueSchema, { value: { case: 'stringValue', value: String(raw) } });
  }
}
