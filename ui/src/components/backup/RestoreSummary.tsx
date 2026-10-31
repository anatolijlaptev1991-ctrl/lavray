// SPDX-License-Identifier: GPL-3.0-only

// RestoreSummary.tsx — сводка копии перед заменой данных (T-83): числа групп,
// серверов, подписок, наборов и настроек, версия приложения и дата создания.
import type { JSX } from 'react';
import type { BackupSummary } from '../../gen/lavray_pb';
import { useI18n } from '../../hooks/useI18n';
import { locale } from '../../lib/i18n';

interface Props {
  readonly summary: BackupSummary;
}

export function RestoreSummary({ summary }: Props): JSX.Element {
  const { t, lang } = useI18n();
  const created =
    summary.createdAtMs > 0n ? new Date(Number(summary.createdAtMs)).toLocaleString(locale(lang)) : '—';
  const rows: readonly (readonly [string, string])[] = [
    [t('bk.sumGroups'), String(summary.groups)],
    [t('bk.sumProfiles'), String(summary.profiles)],
    [t('bk.sumSubs'), String(summary.subscriptions)],
    [t('bk.sumPresets'), String(summary.presets)],
    [t('bk.sumSettings'), String(summary.settings)],
    [t('bk.sumVersion'), summary.appVersion === '' ? '—' : summary.appVersion],
    [t('bk.sumDate'), created],
  ];
  return (
    <section aria-labelledby="bkSumTitle">
      <h3 id="bkSumTitle" className="cap">
        {t('bk.sumTitle')}
      </h3>
      <dl className="bk-sum">
        {rows.map(([label, value]) => (
          <div className="set-row" key={label} style={{ padding: '4px 0' }}>
            <dt className="set-l">{label}</dt>
            <dd className="set-ctl" style={{ margin: 0 }}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
