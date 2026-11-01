// SPDX-License-Identifier: GPL-3.0-only

// UnsupportedBadge.tsx — бейдж «не поддерживается ядром» у профиля, который ядро
// не соберёт (Profile.unsupported_reason, вычисляется ядром). Сейчас единственная
// причина — XHTTP; неизвестную причину показываем общей подписью, чтобы новые
// транспорты не оставались без пометки.
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import type { MessageKey } from '../../lib/i18n';

/** Причина → подпись бейджа. */
const LABELS: Readonly<Record<string, MessageKey>> = {
  xhttp_unsupported: 'prof.unsupported.xhttp',
};

function unsupportedLabel(reason: string): MessageKey | null {
  if (reason === '') return null;
  return LABELS[reason] ?? 'prof.unsupported';
}

export function UnsupportedBadge({ reason }: { readonly reason: string }): JSX.Element | null {
  const { t } = useI18n();
  const key = unsupportedLabel(reason);
  if (key === null) return null;
  return (
    <span className="badge badge-warn" title={t('prof.unsupported.d')}>
      {t(key)}
    </span>
  );
}
