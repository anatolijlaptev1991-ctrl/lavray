// SPDX-License-Identifier: GPL-3.0-only

// DnsRow.tsx — «Удалённый DNS» активного набора правил в карточке «Качество
// связи». Данные — GetDns (DNS принадлежит набору, экран DNS показывает те же
// карточки); смена набора перечитывает подпись. Пока ответа нет — «—».
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { DnsSettings } from '../../gen/lavray_pb';
import { useCore } from '../../hooks/useCore';
import { useI18n } from '../../hooks/useI18n';
import { dnsLabel } from '../../lib/dnsLabel';

export function DnsRow({ presetId }: { readonly presetId: string }): JSX.Element {
  const { t } = useI18n();
  const core = useCore();
  const [dns, setDns] = useState<DnsSettings | null>(null);
  useEffect(() => {
    const guard = { live: true };
    setDns(null);
    void (async (): Promise<void> => {
      try {
        const res = await core.dns.getDns({});
        if (guard.live) setDns(res);
      } catch {
        /* ядро недоступно: подпись останется «—», ошибку покажет сам экран */
      }
    })();
    return (): void => {
      guard.live = false;
    };
  }, [core, presetId]);
  const label = dnsLabel(dns, t);
  return (
    <div className="hl-cell" id="hlDns">
      <span className="cap">{t('health.dns')}</span>
      <span className="val" title={label ?? t('st.na')}>
        {label ?? '—'}
      </span>
    </div>
  );
}
