// SPDX-License-Identifier: GPL-3.0-only

// RollbackAction.tsx — «Откатить» подписку к снимку последнего удачного
// обновления (RollbackSubscription): состав и порядок серверов группы
// возвращаются. Откат меняет данные, поэтому сначала подтверждение. Ядро
// отвечает success=false, если снимка нет (обновлений ещё не было).
import { useState } from 'react';
import type { JSX } from 'react';
import { ConfirmDialog } from '../../components/dialogs';
import type { Group } from '../../gen/lavray_pb';
import { useCore } from '../../hooks/useCore';
import { useI18n } from '../../hooks/useI18n';
import { showCoreError } from '../../lib/core';

interface Props {
  readonly group: Group;
  /** Откат удался: текст итога. */
  readonly onDone: (text: string) => void;
}

export function RollbackAction({ group, onDone }: Props): JSX.Element {
  const { t, tf } = useI18n();
  const core = useCore();
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState('');

  const rollback = async (): Promise<void> => {
    setAsking(false);
    setErr('');
    try {
      const res = await core.subscriptions.rollbackSubscription({ groupId: group.id });
      if (!res.success) {
        setErr(t('subs.rollback.fail'));
        return;
      }
      onDone(tf('subs.rollback.done', { name: group.name, n: res.restoredCount ?? 0 }));
    } catch (e) {
      setErr(showCoreError(e, t));
    }
  };

  return (
    <>
      <button
        className="btn btn-ghost btn-sm"
        title={t('subs.rollback.d')}
        onClick={() => {
          setAsking(true);
        }}
      >
        {t('subs.rollback')}
      </button>
      {err !== '' && (
        <span className="toast-err" role="alert">
          {err}
        </span>
      )}
      {asking && (
        <ConfirmDialog
          title={tf('subs.rollback.t', { name: group.name })}
          text={t('subs.rollback.d')}
          confirmLabel={t('subs.rollback')}
          danger
          onConfirm={() => void rollback()}
          onClose={() => {
            setAsking(false);
          }}
        />
      )}
    </>
  );
}
