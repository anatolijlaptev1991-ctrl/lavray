// SPDX-License-Identifier: GPL-3.0-only

// presetSession.ts — состояние экрана наборов маршрутов (T-80): список и
// активный набор, заметка об итоге, баннер «нужен перезапуск», единый разбор
// ошибок операций. Сами операции — usePresets.ts.
import { Code, ConnectError } from '@connectrpc/connect';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { RoutingPreset } from '../gen/lavray_pb';
import { showCoreError } from '../lib/core';
import type { CoreClients } from '../lib/core';
import { useCore } from './useCore';
import { useI18n } from './useI18n';

export interface PresetNote {
  readonly kind: 'ok' | 'err';
  readonly text: string;
}

export const ok = (text: string): PresetNote => ({ kind: 'ok', text });

export interface PresetSession {
  readonly core: CoreClients;
  readonly presets: readonly RoutingPreset[];
  readonly activeId: string;
  /** Последние presets/activeId для обработчиков, которые не должны пересоздаваться. */
  readonly latest: MutableRefObject<{ presets: readonly RoutingPreset[]; activeId: string }>;
  readonly setPresets: (update: (prev: readonly RoutingPreset[]) => readonly RoutingPreset[]) => void;
  readonly setActiveId: (id: string) => void;
  readonly note: PresetNote | null;
  readonly setNote: (note: PresetNote | null) => void;
  readonly needsRestart: boolean;
  readonly setNeedsRestart: (on: boolean) => void;
  readonly restarting: boolean;
  readonly reload: () => Promise<void>;
  /** Операция с единым разбором ошибок; результат — заметка об успехе (или ничего). */
  readonly run: (op: () => Promise<PresetNote | undefined>) => Promise<void>;
  /** ActivatePreset без перечитывания списка; нужен перезапуск — включает баннер. */
  readonly activateNow: (id: string) => Promise<void>;
  readonly restart: () => Promise<void>;
}

export function usePresetSession(): PresetSession {
  const core = useCore();
  const { t } = useI18n();
  const [presets, setPresets] = useState<readonly RoutingPreset[]>([]);
  const [activeId, setActiveId] = useState('');
  const [note, setNote] = useState<PresetNote | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const latest = useRef({ presets, activeId });
  latest.current = { presets, activeId };

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await core.routing.listPresets({});
      setPresets(res.presets);
      setActiveId(res.activePresetId);
    } catch (e) {
      setNote({ kind: 'err', text: showCoreError(e, t) });
    }
  }, [core, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ABORTED — набор изменили в другом месте: перечитываем и просим повторить правку.
  const run = useCallback(
    async (op: () => Promise<PresetNote | undefined>): Promise<void> => {
      setNote(null);
      try {
        const done = await op();
        if (done !== undefined) setNote(done);
      } catch (e) {
        await reload();
        const aborted = ConnectError.from(e).code === Code.Aborted;
        setNote({ kind: 'err', text: aborted ? t('toast.presetConflict') : showCoreError(e, t) });
      }
    },
    [reload, t],
  );

  const activateNow = useCallback(
    async (id: string): Promise<void> => {
      const res = await core.routing.activatePreset({ id });
      setActiveId(id);
      if (res.needsProfileRestart) setNeedsRestart(true);
    },
    [core],
  );

  const restart = useCallback(async (): Promise<void> => {
    setNote(null);
    setRestarting(true);
    try {
      await core.core.restartProfile({});
      setNeedsRestart(false);
    } catch (e) {
      setNote({ kind: 'err', text: showCoreError(e, t) });
    } finally {
      setRestarting(false);
    }
  }, [core, t]);

  return {
    core, presets, activeId, latest, setPresets, setActiveId, note, setNote,
    needsRestart, setNeedsRestart, restarting, reload, run, activateNow, restart,
  };
}
