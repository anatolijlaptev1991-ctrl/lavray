// SPDX-License-Identifier: GPL-3.0-only

// RuleCopyDialog.tsx — «Создать правило» при активном встроенном наборе (T-80):
// встроенный набор менять нельзя, поэтому предлагается его копия с правилом.
import type { JSX } from 'react';
import { ConfirmDialog } from '../../components/dialogs';
import { useI18n } from '../../hooks/useI18n';
import type { PendingCopy } from '../../hooks/useConnRule';
import { presetTitle } from '../../lib/presets';

export interface RuleCopyDialogProps {
  readonly pending: PendingCopy;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

export function RuleCopyDialog({ pending, onConfirm, onClose }: RuleCopyDialogProps): JSX.Element {
  const { t, tf } = useI18n();
  const name = presetTitle(pending.active.id, pending.active.displayName, t);
  return (
    <ConfirmDialog
      title={t('conns.ruleCopy.t')}
      text={tf('conns.ruleCopy.d', { name, rule: pending.rule.entry })}
      confirmLabel={t('conns.ruleCopy.ok')}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
