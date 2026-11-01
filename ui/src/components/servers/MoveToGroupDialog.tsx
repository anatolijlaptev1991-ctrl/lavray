// SPDX-License-Identifier: GPL-3.0-only

// MoveToGroupDialog.tsx — «Переместить в группу» (MoveProfiles): выбор группы и
// подтверждение. Подписочные группы не предлагаются: следующее обновление
// подписки удалило бы перенесённые вручную серверы.
import { useState } from 'react';
import type { JSX } from 'react';
import { Group_Kind } from '../../gen/lavray_pb';
import { useCore } from '../../hooks/useCore';
import { useI18n } from '../../hooks/useI18n';
import { showCoreError } from '../../lib/core';
import { groupDisplayName } from '../../lib/groups';
import { DialogShell } from '../dialogs';

export interface MoveGroup {
  readonly id: bigint;
  readonly name: string;
  readonly kind: Group_Kind;
}

interface Props {
  readonly ids: readonly bigint[];
  readonly groups: readonly MoveGroup[];
  /** Группа, где серверы уже лежат: в списке выбрана не она. */
  readonly currentGroupId?: bigint;
  readonly onClose: () => void;
  /** Серверы перенесены: экран перечитывает список и снимает выделение. */
  readonly onMoved: () => void;
}

export function MoveToGroupDialog({ ids, groups, currentGroupId, onClose, onMoved }: Props): JSX.Element {
  const { t, tf } = useI18n();
  const core = useCore();
  const targets = groups.filter((g) => g.kind !== Group_Kind.SUBSCRIPTION);
  const first = targets.find((g) => g.id !== currentGroupId) ?? targets[0];
  const [target, setTarget] = useState(first === undefined ? '' : String(first.id));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const move = async (): Promise<void> => {
    setErr('');
    setBusy(true);
    try {
      await core.profiles.moveProfiles({ ids: [...ids], targetGroupId: BigInt(target) });
      onMoved();
      onClose();
    } catch (e) {
      setErr(showCoreError(e, t));
      setBusy(false);
    }
  };

  return (
    <DialogShell
      titleId="mvTitle"
      title={t('mv.title')}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <span className="flex1" />
          <button className="btn btn-pri" disabled={busy || target === ''} onClick={() => void move()}>
            {t('mv.do')}
          </button>
        </>
      }
    >
      <p style={{ fontSize: '.8125rem', marginBottom: 10 }}>{tf('mv.text', { n: ids.length })}</p>
      {targets.length === 0 ? (
        <p className="cap">{t('mv.none')}</p>
      ) : (
        <label className="prof-filter">
          <span className="cap">{t('mv.target')}</span>
          <select
            className="select"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
            }}
          >
            {targets.map((g) => (
              <option key={String(g.id)} value={String(g.id)}>
                {groupDisplayName(g, t)}
              </option>
            ))}
          </select>
        </label>
      )}
      {err !== '' && (
        <p className="toast-err" role="alert">
          {err}
        </p>
      )}
    </DialogShell>
  );
}
