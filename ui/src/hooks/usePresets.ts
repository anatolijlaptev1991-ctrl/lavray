// SPDX-License-Identifier: GPL-3.0-only

// usePresets.ts — наборы маршрутов для экрана «Правила» (T-80): правка своих
// наборов, копии, удаление, сброс, обмен файлом. Состояние и разбор ошибок —
// presetSession.ts: ABORTED перечитывает список и сообщает о конфликте, а
// изменение активного набора при работающем соединении включает баннер
// «нужен перезапуск» (needsRestart).
import { create } from '@bufbuild/protobuf';
import { useCallback } from 'react';
import { CoreState, Outbound, RoutingPresetSchema, SniffingMode } from '../gen/lavray_pb';
import type { RoutingPreset } from '../gen/lavray_pb';
import { applyPatch, isChanged } from '../lib/presetDraft';
import type { PresetPatch } from '../lib/presetDraft';
import { saveFile } from '../lib/saveFile';
import { ok, usePresetSession } from './presetSession';
import type { PresetNote } from './presetSession';
import { useI18n } from './useI18n';

export type { PresetNote };

export interface PresetsApi {
  readonly presets: readonly RoutingPreset[];
  readonly activeId: string;
  readonly active: RoutingPreset | undefined;
  readonly note: PresetNote | null;
  readonly needsRestart: boolean;
  readonly restarting: boolean;
  readonly activate: (id: string) => Promise<void>;
  /** Правка своего набора (UpdatePreset с проверкой ревизии); пустая правка в ядро не уходит. */
  readonly update: (id: string, patch: PresetPatch) => Promise<void>;
  /** Копия набора; name — своё имя (иначе имя от ядра), activateIt — сразу сделать активной. */
  readonly copy: (sourceId: string, name: string | undefined, activateIt: boolean) => Promise<void>;
  readonly createEmpty: (name: string) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
  readonly reset: (id: string) => Promise<void>;
  readonly exportPreset: (id: string) => Promise<void>;
  readonly importText: (json: string) => Promise<void>;
  readonly showNote: (note: PresetNote | null) => void;
  readonly restart: () => Promise<void>;
  readonly dismissRestart: () => void;
}

export function usePresets(): PresetsApi {
  const s = usePresetSession();
  const { core, run, reload, activateNow, setPresets, setNeedsRestart, setActiveId, latest } = s;
  const { t, tf } = useI18n();

  const activate = useCallback(
    (id: string) => run(async () => { await activateNow(id); await reload(); return ok(t('toast.presetActivated')); }),
    [run, activateNow, reload, t],
  );

  const update = useCallback(
    (id: string, patch: PresetPatch) =>
      run(async () => {
        const base = latest.current.presets.find((p) => p.id === id);
        if (base === undefined || base.builtin) return undefined;
        const next = applyPatch(base, patch);
        if (!isChanged(base, next)) return undefined;
        const res = await core.routing.updatePreset({ preset: next, expectedRevision: base.revision });
        const saved = res.preset ?? next;
        setPresets((prev) => prev.map((p) => (p.id === id ? saved : p)));
        if (res.needsProfileRestart) setNeedsRestart(true);
        return ok(t('toast.presetSaved'));
      }),
    [run, core, latest, setPresets, setNeedsRestart, t],
  );

  const afterCreate = useCallback(
    async (made: RoutingPreset, activateIt: boolean): Promise<void> => {
      if (activateIt) await activateNow(made.id);
      await reload();
    },
    [activateNow, reload],
  );

  const copy = useCallback(
    (sourceId: string, name: string | undefined, activateIt: boolean) =>
      run(async () => {
        let made = await core.routing.createPreset({ builtinSourceId: sourceId });
        const wanted = name?.trim() ?? '';
        if (wanted !== '' && wanted !== made.displayName) {
          const res = await core.routing.updatePreset({ preset: applyPatch(made, { displayName: wanted }), expectedRevision: made.revision });
          made = res.preset ?? made;
        }
        await afterCreate(made, activateIt);
        return ok(t('toast.presetCopied'));
      }),
    [run, core, afterCreate, t],
  );

  const createEmpty = useCallback(
    (name: string) =>
      run(async () => {
        const values = create(RoutingPresetSchema, {
          displayName: name.trim(),
          defaultOutbound: Outbound.PROXY,
          sniffingMode: SniffingMode.SNIFFING_FOR_ROUTING,
        });
        await afterCreate(await core.routing.createPreset({ preset: values }), true);
        return ok(t('toast.presetSaved'));
      }),
    [run, core, afterCreate, t],
  );

  const remove = useCallback(
    (id: string) =>
      run(async () => {
        const res = await core.routing.deletePreset({ id });
        if (res.newActiveId !== '') setActiveId(res.newActiveId);
        if (res.needsProfileRestart) setNeedsRestart(true);
        await reload();
        return ok(t('toast.presetDeleted'));
      }),
    [run, core, reload, setActiveId, setNeedsRestart, t],
  );

  const reset = useCallback(
    (id: string) =>
      run(async () => {
        await core.routing.resetBuiltinPreset({ id });
        // ResetBuiltinPreset не сообщает о перезапуске: узнаём по состоянию ядра.
        if (id === latest.current.activeId) {
          const st = await core.core.getStatus({}).catch(() => undefined);
          if (st?.state === CoreState.CONNECTED || st?.state === CoreState.CONNECTING) setNeedsRestart(true);
        }
        await reload();
        return ok(t('toast.presetReset'));
      }),
    [run, core, latest, reload, setNeedsRestart, t],
  );

  const exportPreset = useCallback(
    (id: string) =>
      run(async () => {
        const res = await core.routing.exportPreset({ id });
        const saved = await saveFile(res.suggestedName, 'json', res.json);
        return saved === 'saved' ? ok(t('toast.presetExported')) : undefined;
      }),
    [run, core, t],
  );

  const importText = useCallback(
    (json: string) =>
      run(async () => {
        const res = await core.routing.importPreset({ json });
        await reload();
        return ok(res.warnings.length > 0 ? tf('toast.presetImportedWarn', { n: res.warnings.length }) : t('toast.presetImported'));
      }),
    [run, core, reload, t, tf],
  );

  return {
    presets: s.presets,
    activeId: s.activeId,
    active: s.presets.find((p) => p.id === s.activeId),
    note: s.note,
    needsRestart: s.needsRestart,
    restarting: s.restarting,
    activate,
    update,
    copy,
    createEmpty,
    remove,
    reset,
    exportPreset,
    importText,
    showNote: s.setNote,
    restart: s.restart,
    dismissRestart: (): void => { setNeedsRestart(false); },
  };
}
