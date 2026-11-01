// SPDX-License-Identifier: GPL-3.0-only

// NekoBoxImportDialog.tsx — «Перенос из NekoBox» (T-78, FR-UI-277): путь или
// «Выбрать папку…», найденные установки, предпросмотр чисел, подтверждение и
// отчёт с причинами пропусков. Перенос недоступен, пока не сделан предпросмотр
// именно этих путей и галочек: любое изменение формы сбрасывает предпросмотр.
// Источник только читается, NekoBox не запускается и не останавливается.
import { useRef, useState } from 'react';
import type { JSX } from 'react';
import type { NekoBoxReport } from '../../gen/lavray_pb';
import { useCore } from '../../hooks/useCore';
import { useI18n } from '../../hooks/useI18n';
import { useNekoBoxDetect } from '../../hooks/useNekoBoxDetect';
import { nekoBoxErrorText } from '../../lib/nekoBox';
import { pickFolder } from '../../lib/pickFolder';
import { DialogShell } from '../DialogShell';
import { NekoBoxForm } from './NekoBoxForm';
import { NekoBoxReportView } from './NekoBoxReportView';

interface Props {
  readonly onClose: () => void;
  /** Перенос выполнен (данные в базе изменились). */
  readonly onImported?: () => void;
}

type Phase = 'form' | 'previewed' | 'done';

export function NekoBoxImportDialog({ onClose, onImported }: Props): JSX.Element {
  const { t } = useI18n();
  const core = useCore();
  const detect = useNekoBoxDetect();
  const pathRef = useRef<HTMLInputElement | null>(null);
  const [path, setPath] = useState('');
  const [routes, setRoutes] = useState(true);
  const [settings, setSettings] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [report, setReport] = useState<NekoBoxReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [activated, setActivated] = useState(false);

  // Любое изменение формы обесценивает предпросмотр.
  const edit = <T,>(set: (v: T) => void) => (v: T): void => {
    set(v);
    setPhase('form');
    setReport(null);
    setErr('');
  };

  const request = (): { path: string; includeRoutes: boolean; includeSettings: boolean } | null => {
    if (path.trim() === '') {
      setErr(t('nb.err.empty'));
      return null;
    }
    return { path: path.trim(), includeRoutes: routes, includeSettings: settings };
  };

  const run = async (dry: boolean): Promise<void> => {
    const req = request();
    if (req === null) return;
    setBusy(true);
    setErr('');
    try {
      const res = dry ? await core.migration.previewNekoBoxImport(req) : await core.migration.importNekoBox(req);
      setReport(res);
      setPhase(dry ? 'previewed' : 'done');
      if (!dry) onImported?.();
    } catch (e) {
      setErr(nekoBoxErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (): Promise<void> => {
    try {
      const chosen = await pickFolder();
      if (chosen !== null) edit(setPath)(chosen);
    } catch {
      setErr(t('nb.err.pick'));
    }
  };

  const activate = async (): Promise<void> => {
    const id = report?.nekoboxActiveRoute;
    if (id === undefined) return;
    setBusy(true);
    try {
      await core.routing.activatePreset({ id });
      setActivated(true);
    } catch (e) {
      setErr(nekoBoxErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const canActivate = phase === 'done' && report?.nekoboxActiveRoute !== undefined && !activated;
  return (
    <DialogShell
      titleId="nbTitle"
      title={t('nb.title')}
      size="lg"
      autofocusRef={pathRef}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        phase === 'done' ? (
          <>
            {canActivate && (
              <button className="btn btn-sec" disabled={busy} onClick={() => void activate()}>
                {t('nb.activate')}
              </button>
            )}
            {activated && <span className="cap" role="status">{t('nb.activated')}</span>}
            <span className="flex1" />
            <button className="btn btn-pri" onClick={onClose}>
              {t('nb.done')}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <span className="flex1" />
            <button className="btn btn-sec" disabled={busy} onClick={() => void run(true)}>
              {busy && phase === 'form' ? t('nb.previewing') : t('nb.preview')}
            </button>
            <button className="btn btn-pri" disabled={busy || phase !== 'previewed'} onClick={() => void run(false)}>
              {busy && phase === 'previewed' ? t('nb.importing') : t('nb.import')}
            </button>
          </>
        )
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {err !== '' && (
          <div className="banner banner-err" role="alert">
            <div className="bn-t">{err}</div>
          </div>
        )}
        {phase !== 'done' && (
          <NekoBoxForm
            path={path}
            routes={routes}
            settings={settings}
            candidates={detect.candidates}
            loading={detect.loading}
            busy={busy}
            pathRef={pathRef}
            onPath={edit(setPath)}
            onPick={() => void pick()}
            onRoutes={edit(setRoutes)}
            onSettings={edit(setSettings)}
          />
        )}
        {report !== null && <NekoBoxReportView report={report} mode={phase === 'done' ? 'result' : 'preview'} />}
      </div>
    </DialogShell>
  );
}
