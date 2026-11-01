// SPDX-License-Identifier: GPL-3.0-only

// UpdateBadge.tsx — метка обновления (T-75): «Обязательное», если так подписано в
// манифесте, иначе «Бета» для обновления из бета-канала. Раньше обязательное
// обновление подписывалось словом «Бета» (дефект F-076): теперь «Обязательное»
// всегда побеждает, а стабильное необязательное обновление метки не имеет.
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import type { AvailableUpdate } from '../../lib/updates/types';

export function UpdateBadge({ update }: { readonly update: AvailableUpdate }): JSX.Element | null {
  const { t } = useI18n();
  if (update.mandatory) {
    return (
      <span className="badge badge-warn" data-badge="mandatory">
        {t('upd.mandatory')}
      </span>
    );
  }
  if (update.channel === 'beta') {
    return (
      <span className="badge badge-soft" data-badge="beta">
        {t('upd.beta')}
      </span>
    );
  }
  return null;
}
