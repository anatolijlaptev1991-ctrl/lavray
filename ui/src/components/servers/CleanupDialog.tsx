// SPDX-License-Identifier: GPL-3.0-only

// CleanupDialog.tsx — очистка группы серверов (Ctrl+Alt+R / Ctrl+Alt+D в NekoBox):
// «Недоступные» (RemoveUnavailableProfiles) и «Дубликаты» (DeduplicateProfiles).
// Порядок всегда один: пробный прогон → список → подтверждение. Ничего не
// удаляется, пока пользователь не увидел список; активный сервер и звенья
// цепочек ядро не трогает и называет отдельно (skipped_ids).
import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { Profile } from '../../gen/lavray_pb';
import { useCore } from '../../hooks/useCore';
import { useI18n } from '../../hooks/useI18n';
import { showCoreError } from '../../lib/core';
import { groupDisplayName } from '../../lib/groups';
import { DialogShell } from '../dialogs';
import type { MoveGroup } from './MoveToGroupDialog';

type Mode = 'unavailable' | 'duplicates';

/** Результат пробного прогона: что удалится и что ядро пропустило. */
interface Plan {
  readonly mode: Mode;
  readonly groupId: bigint;
  readonly names: readonly string[];
  readonly count: number;
  readonly skipped: number;
}

interface Props {
  readonly groups: readonly MoveGroup[];
  /** Все профили (имена для списка по id). */
  readonly profiles: readonly Profile[];
  /** Группа, выбранная на экране; нет — первая. */
  readonly initialGroupId?: bigint | undefined;
  readonly onClose: () => void;
  /** Удалено n серверов: экран перечитывает список и показывает итог. */
  readonly onDone: (removed: number) => void;
}

export function CleanupDialog({ groups, profiles, initialGroupId, onClose, onDone }: Props): JSX.Element {
  const { t, tf } = useI18n();
  const core = useCore();
  const [mode, setMode] = useState<Mode>('unavailable');
  const [group, setGroup] = useState(String(initialGroupId ?? groups[0]?.id ?? ''));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const names = useMemo(() => new Map(profiles.map((p) => [p.id, p.name])), [profiles]);
  const nameOf = (id: bigint): string => names.get(id) ?? String(id);

  const run = async (apply: boolean): Promise<void> => {
    setErr('');
    setBusy(true);
    try {
      const groupId = BigInt(group);
      const next = await (mode === 'unavailable' ? unavailable(groupId, apply) : duplicates(groupId, apply));
      if (apply) {
        onDone(next.count);
        onClose();
        return;
      }
      setPlan(next);
    } catch (e) {
      setErr(showCoreError(e, t));
    } finally {
      setBusy(false);
    }
  };

  const unavailable = async (groupId: bigint, apply: boolean): Promise<Plan> => {
    const res = await core.profiles.removeUnavailableProfiles({ groupId, apply });
    const ids = apply ? res.removedIds : res.wouldRemoveIds;
    return { mode, groupId, names: ids.map(nameOf), count: ids.length, skipped: res.skippedIds.length };
  };

  const duplicates = async (groupId: bigint, apply: boolean): Promise<Plan> => {
    const res = await core.profiles.deduplicateProfiles({ groupId, apply });
    const list = apply ? res.removedIds.map(nameOf) : res.duplicates.map((p) => p.name);
    return { mode, groupId, names: list, count: list.length, skipped: 0 };
  };

  // Смена режима или группы делает прежний список недействительным.
  const reset = (): void => {
    setPlan(null);
    setErr('');
  };
  const ready = plan !== null && plan.mode === mode && String(plan.groupId) === group;

  return (
    <DialogShell
      titleId="cleanTitle"
      title={t('clean.title')}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <span className="flex1" />
          {ready && plan.count > 0 ? (
            <button className="btn btn-danger-solid" disabled={busy} onClick={() => void run(true)}>
              {tf('clean.do', { n: plan.count })}
            </button>
          ) : (
            <button className="btn btn-pri" disabled={busy || group === ''} onClick={() => void run(false)}>
              {t('clean.check')}
            </button>
          )}
        </>
      }
    >
      <div className="seg mini" role="group" aria-label={t('clean.title')}>
        {(['unavailable', 'duplicates'] as const).map((m) => (
          <button
            key={m}
            className={mode === m ? 'on' : ''}
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              reset();
            }}
          >
            {t(m === 'unavailable' ? 'clean.mode.unavail' : 'clean.mode.dup')}
          </button>
        ))}
      </div>
      <p className="cap" style={{ margin: '8px 0' }}>
        {t(mode === 'unavailable' ? 'clean.hint.unavail' : 'clean.hint.dup')}
      </p>
      <label className="prof-filter">
        <span className="cap">{t('clean.group')}</span>
        <select
          className="select"
          value={group}
          onChange={(e) => {
            setGroup(e.target.value);
            reset();
          }}
        >
          {groups.map((g) => (
            <option key={String(g.id)} value={String(g.id)}>
              {groupDisplayName(g, t)}
            </option>
          ))}
        </select>
      </label>
      {ready && (
        <div role="status" style={{ marginTop: 12 }}>
          <b>{plan.count > 0 ? tf('clean.found', { n: plan.count }) : t('clean.none')}</b>
          {plan.names.length > 0 && (
            <ul className="imp-prev-list">
              {plan.names.slice(0, 20).map((name, i) => (
                <li key={`${name}-${String(i)}`}>
                  <span className="mono">{name}</span>
                </li>
              ))}
              {plan.names.length > 20 && <li className="muted">…</li>}
            </ul>
          )}
          {plan.skipped > 0 && <p className="cap">{tf('clean.skipped', { n: plan.skipped })}</p>}
        </div>
      )}
      {err !== '' && (
        <p className="toast-err" role="alert">
          {err}
        </p>
      )}
    </DialogShell>
  );
}
