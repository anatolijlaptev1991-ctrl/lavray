// SPDX-License-Identifier: GPL-3.0-only

// useConnRule.ts — «Создать правило» из строки соединения (T-80): адрес
// соединения попадает в список активного набора («напрямую» / «через прокси»).
// Свой набор правится сразу (UpdatePreset). Встроенный нельзя менять, поэтому
// сначала предлагается его копия: `pending` — вопрос пользователю, confirmCopy —
// «Создать копию»: копия, правило в ней и активация. Итог — заметка (notify).
import { Code, ConnectError } from '@connectrpc/connect';
import { useCallback, useState } from 'react';
import type { Connection, RoutingPreset } from '../gen/lavray_pb';
import { friendlyCoreError } from '../lib/core';
import { addEntry, applyPatch } from '../lib/presetDraft';
import { presetTitle } from '../lib/presets';
import { ruleFromConnection } from '../lib/ruleFromConnection';
import type { ConnRule, RuleOutbound } from '../lib/ruleFromConnection';
import type { ConnNote } from './useConnActions';
import { useCore } from './useCore';
import { useI18n } from './useI18n';

export interface PendingCopy {
  readonly rule: ConnRule;
  /** Активный встроенный набор, от которого предлагается копия. */
  readonly active: RoutingPreset;
}

export interface ConnRuleApi {
  readonly pending: PendingCopy | null;
  readonly start: (conn: Connection, out: RuleOutbound) => Promise<void>;
  readonly confirmCopy: () => Promise<void>;
  readonly cancel: () => void;
}

export function useConnRule(notify: (note: ConnNote) => void): ConnRuleApi {
  const core = useCore();
  const { t, tf } = useI18n();
  const [pending, setPending] = useState<PendingCopy | null>(null);

  const fail = useCallback(
    (e: unknown): void => {
      const aborted = ConnectError.from(e).code === Code.Aborted;
      notify({ kind: 'err', text: aborted ? t('toast.presetConflict') : friendlyCoreError(e, t) });
    },
    [notify, t],
  );

  const reportAdded = useCallback(
    (name: string, restart: boolean): void => {
      notify({ kind: 'ok', text: tf(restart ? 'conns.ruleAddedRestart' : 'conns.ruleAdded', { name }) });
    },
    [notify, tf],
  );

  /** Правило в свой набор. */
  const addToOwn = useCallback(
    async (preset: RoutingPreset, rule: ConnRule): Promise<void> => {
      const res = addEntry(preset[rule.kind], rule.entry);
      if (res.kind !== 'added') {
        notify({ kind: 'ok', text: tf('conns.ruleExists', { name: preset.displayName }) });
        return;
      }
      const next = applyPatch(preset, { lists: { [rule.kind]: res.list } });
      const saved = await core.routing.updatePreset({ preset: next, expectedRevision: preset.revision });
      reportAdded(preset.displayName, saved.needsProfileRestart);
    },
    [core, notify, tf, reportAdded],
  );

  const start = useCallback(
    async (conn: Connection, out: RuleOutbound): Promise<void> => {
      const rule = ruleFromConnection(conn, out);
      if (rule === null) {
        notify({ kind: 'err', text: t('conns.ruleNone') });
        return;
      }
      try {
        const list = await core.routing.listPresets({});
        const active = list.presets.find((p) => p.id === list.activePresetId);
        if (active === undefined) notify({ kind: 'err', text: t('rt.empty.d') });
        else if (active.builtin) setPending({ rule, active });
        else await addToOwn(active, rule);
      } catch (e) {
        fail(e);
      }
    },
    [core, notify, t, addToOwn, fail],
  );

  const confirmCopy = useCallback(async (): Promise<void> => {
    if (pending === null) return;
    const { rule, active } = pending;
    setPending(null);
    try {
      const made = await core.routing.createPreset({ builtinSourceId: active.id });
      const added = addEntry(made[rule.kind], rule.entry);
      const name = tf('rt.copyName', { name: presetTitle(active.id, active.displayName, t) });
      const next = applyPatch(made, { displayName: name, lists: added.kind === 'added' ? { [rule.kind]: added.list } : {} });
      await core.routing.updatePreset({ preset: next, expectedRevision: made.revision });
      const activated = await core.routing.activatePreset({ id: made.id });
      reportAdded(name, activated.needsProfileRestart);
    } catch (e) {
      fail(e);
    }
  }, [core, pending, t, tf, reportAdded, fail]);

  return { pending, start, confirmCopy, cancel: (): void => { setPending(null); } };
}
