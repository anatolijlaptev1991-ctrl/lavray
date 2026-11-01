// SPDX-License-Identifier: GPL-3.0-only

// presetKit.ts — подставное ядро для тестов редактора наборов (T-80): список
// наборов хранится в памяти, CreatePreset / UpdatePreset / ActivatePreset /
// DeletePreset меняют его так же, как ядро (копия получает id custom:copy-N,
// UpdatePreset поднимает ревизию). Запросы идут через настоящие клиенты (stubCore).
import { act } from 'react';
import type { Json, Route } from './coreStub';

/** Встроенный набор в виде ответа ядра (displayName — ключ «preset.<id>»). */
export const builtinPreset = (id: string, extra: Json = {}): Json => ({
  id,
  displayName: `preset.${id}`,
  builtin: true,
  revision: 2,
  ...extra,
});

/** Свой набор; builtinSourceId задаёт копию встроенного. */
export const customPreset = (id: string, name: string, extra: Json = {}): Json => ({
  id,
  displayName: name,
  builtin: false,
  revision: 3,
  ...extra,
});

export interface PresetKit {
  readonly routes: Record<string, Route>;
  /** Текущее состояние «ядра». */
  readonly state: { list: Json[]; active: string };
}

interface PresetReq {
  readonly id?: string;
  readonly builtinSourceId?: string;
  readonly preset?: Json;
  readonly expectedRevision?: number;
}

export function presetKit(list: Json[], active: string): PresetKit {
  const state = { list: [...list], active };
  let copies = 0;
  const routes: Record<string, Route> = {
    'RoutingService/ListPresets': () => ({ presets: state.list, activePresetId: state.active }),
    'RoutingService/CreatePreset': (_n, body) => {
      const req = body as PresetReq;
      copies += 1;
      const src = state.list.find((p) => p.id === req.builtinSourceId);
      const made: Json = {
        ...(src ?? {}),
        ...(req.preset ?? {}),
        id: `custom:copy-${String(copies)}`,
        displayName: req.preset?.displayName ?? `Copy ${String(copies)}`, // имя от ядра (клиент переименует)
        builtin: false,
        revision: 1,
        builtinSourceId: src === undefined ? '' : String(src.id),
      };
      state.list.push(made);
      return made;
    },
    'RoutingService/UpdatePreset': (_n, body) => {
      const req = body as PresetReq;
      const updated: Json = { ...req.preset, revision: (req.expectedRevision ?? 0) + 1 };
      state.list = state.list.map((p) => (p.id === updated.id ? updated : p));
      return { preset: updated, newRevision: updated.revision };
    },
    'RoutingService/ActivatePreset': (_n, body) => {
      state.active = (body as PresetReq).id ?? state.active;
      return {};
    },
    'RoutingService/DeletePreset': (_n, body) => {
      const id = (body as PresetReq).id;
      state.list = state.list.filter((p) => p.id !== id);
      return {};
    },
    'RoutingService/ResetBuiltinPreset': (_n, body) => state.list.find((p) => p.id === (body as PresetReq).id) ?? {},
    'RoutingService/ExportPreset': () => ({ json: '{"exported":true}\n', suggestedName: 'my-set' }),
    'RoutingService/ImportPreset': () => ({ preset: customPreset('custom:imported', 'Imported'), warnings: [] }),
  };
  return { routes, state };
}

/** Ввод текста в поле (нативный сеттер value: React иначе не заметит смену). */
export async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}
