// SPDX-License-Identifier: GPL-3.0-only

// NekoBoxReportView.tsx — отчёт о переносе из NekoBox (T-78): числа, что уже
// было перенесено, что пропущено и ПОЧЕМУ (отчёт о потерях, FR-UI-260),
// замечания. Один вид для предпросмотра и для итога: в предпросмотре числа те
// же, что даст перенос.
import type { JSX } from 'react';
import type { NekoBoxReport } from '../../gen/lavray_pb';
import { useI18n } from '../../hooks/useI18n';
import { countsLine, profilesTotal, reportText } from '../../lib/nekoBox';

/** Сколько пропусков и замечаний рисовать: остальное — строкой «…и ещё N». */
const MAX_LISTED = 100;

interface Props {
  readonly report: NekoBoxReport;
  /** preview — сухой прогон («Будет перенесено»), result — итог переноса. */
  readonly mode: 'preview' | 'result';
}

function Listed({ items, children }: { readonly items: readonly string[]; readonly children: (s: string, i: number) => JSX.Element }): JSX.Element {
  const { tf } = useI18n();
  return (
    <ul className="nb-list" style={{ maxHeight: 160, overflowY: 'auto', margin: '4px 0 0', paddingLeft: 18 }}>
      {items.slice(0, MAX_LISTED).map(children)}
      {items.length > MAX_LISTED && <li className="cap">{tf('nb.more', { n: items.length - MAX_LISTED })}</li>}
    </ul>
  );
}

export function NekoBoxReportView({ report, mode }: Props): JSX.Element {
  const { t, tf, lang } = useI18n();
  const servers = profilesTotal(report);
  const headline =
    mode === 'result' ? reportText(report, lang) : `${t('nb.previewTitle')}: ${countsLine(servers, report.groupsImported, report.routesImported, lang)}`;
  const skipped = report.skipped.map((s) => `${s.file}\u0000${s.reason}`);
  return (
    <div className="nb-report" role="region" aria-label={mode === 'result' ? t('nb.reportTitle') : t('nb.previewTitle')}>
      <p style={{ fontWeight: 600, margin: 0 }} role="status">
        {headline}
      </p>
      <ul className="cap" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {report.alreadyPresent > 0 && <li>{tf('nb.already', { n: report.alreadyPresent })}</li>}
        {report.renumbered > 0 && <li>{tf('nb.renumbered', { n: report.renumbered })}</li>}
        {report.routesFound > 0 && <li>{tf('nb.routesFound', { n: report.routesFound, m: report.routesImported })}</li>}
        {report.settingsImported.length > 0 && <li>{tf('nb.settingsDone', { n: report.settingsImported.length })}</li>}
      </ul>
      {mode === 'preview' && (
        <p className="cap" style={{ marginTop: 8 }}>
          {t('nb.previewNote')}
        </p>
      )}
      {skipped.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="set-l">{tf('nb.skipped', { n: skipped.length })}</div>
          <Listed items={skipped}>
            {(s, i) => {
              const [file = '', reason = ''] = s.split('\u0000');
              return (
                <li key={i} className="cap">
                  <span className="mono">{file}</span> — {reason}
                </li>
              );
            }}
          </Listed>
        </div>
      )}
      {report.warnings.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="set-l">{t('nb.warnings')}</div>
          <Listed items={report.warnings}>
            {(w, i) => (
              <li key={i} className="cap">
                {w}
              </li>
            )}
          </Listed>
        </div>
      )}
    </div>
  );
}
