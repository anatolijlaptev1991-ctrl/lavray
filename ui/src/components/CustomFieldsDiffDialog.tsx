// SPDX-License-Identifier: GPL-3.0-only

// CustomFieldsDiffDialog.tsx — подтверждение custom-полей профиля (T-08B, FR-UI-257).
// Показывает, что именно custom-поля меняют в итоговом конфиге (diff без секретов от
// ядра), предупреждения, затронутые ключи, и требует явного согласия. Кнопка «Применить»
// неактивна, пока не отмечен флажок. Состояние и вызовы ядра — в useCustomFieldsConfirm.
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';
import type { CustomFieldsDialogProps } from '../hooks/useCustomFieldsConfirm';
import type { MessageKey } from '../lib/i18n';
import type { PreviewCustomFieldsResponse } from '../gen/lavray_pb';
import { DiffView } from './DiffView';
import { DialogShell } from './dialogs';
import { Icon } from './Icon';

/** Коды предупреждений ядра → тексты; незнакомый код показывается как есть. */
const WARNING_TEXT: ReadonlyMap<string, MessageKey> = new Map<string, MessageKey>([
  ['internal_full', 'cf.warn.internal_full'],
  ['inbounds_changed', 'cf.warn.inbounds_changed'],
]);

function ErrorBanner({ text }: { readonly text: string }): JSX.Element {
  return (
    <div className="banner banner-err" role="alert">
      <span className="ic">
        <Icon name="alert" />
      </span>
      <div className="bn-t">{text}</div>
    </div>
  );
}

function Banner({ text, kind }: { readonly text: string; readonly kind: 'warn' | 'ok' }): JSX.Element {
  return (
    <div className={`banner banner-${kind}`} role={kind === 'warn' ? 'alert' : 'status'}>
      <span className="ic">
        <Icon name={kind === 'warn' ? 'alert' : 'check'} />
      </span>
      <div className="bn-t">{text}</div>
    </div>
  );
}

function Warnings({ codes }: { readonly codes: readonly string[] }): JSX.Element | null {
  const { t, tf } = useI18n();
  if (codes.length === 0) return null;
  return (
    <>
      {codes.map((code) => {
        const key = WARNING_TEXT.get(code);
        return <Banner key={code} kind="warn" text={key === undefined ? tf('cf.warn.other', { code }) : t(key)} />;
      })}
    </>
  );
}

function TouchedKeys({ keys }: { readonly keys: readonly string[] }): JSX.Element | null {
  const { t } = useI18n();
  if (keys.length === 0) return null;
  return (
    <div className="cf-keys">
      <p className="cap" id="cfKeysCap">
        {t('cf.touched')}
      </p>
      <ul aria-labelledby="cfKeysCap">
        {keys.map((key) => (
          <li className="mono" key={key}>
            {key}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface PreviewProps {
  readonly preview: PreviewCustomFieldsResponse;
  readonly changed: boolean;
  readonly acknowledged: boolean;
  readonly onAcknowledge: (on: boolean) => void;
}

function PreviewBody({ preview, changed, acknowledged, onAcknowledge }: PreviewProps): JSX.Element {
  const { t } = useI18n();
  return (
    <>
      {changed && <Banner kind="warn" text={t('cf.changed')} />}
      {preview.alreadyConfirmed && <Banner kind="ok" text={t('cf.already')} />}
      <Warnings codes={preview.warnings} />
      <TouchedKeys keys={preview.touchedKeys} />
      {preview.diff.trim() === '' ? (
        <p className="cf-note">{t('cf.diffEmpty')}</p>
      ) : (
        <DiffView diff={preview.diff} label={t('cf.diffLabel')} />
      )}
      {preview.diffTruncated && <p className="cf-note">{t('cf.truncated')}</p>}
      <label className="cf-ack">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => {
            onAcknowledge(e.target.checked);
          }}
        />
        <span>{t('cf.ack')}</span>
      </label>
    </>
  );
}

export function CustomFieldsDiffDialog(p: CustomFieldsDialogProps): JSX.Element {
  const { t, tf } = useI18n();
  const canApply = p.phase === 'ready' && p.acknowledged && !p.busy;
  return (
    <DialogShell
      titleId="cfdTitle"
      title={t('cf.title')}
      size="lg"
      onClose={p.onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={p.onClose}>
            {t('common.cancel')}
          </button>
          <span className="flex1" />
          <button className="btn btn-pri" disabled={!canApply} onClick={p.onApply}>
            {t('cf.apply')}
          </button>
        </>
      }
    >
      <p className="cf-for">{tf('cf.forProfile', { name: p.name })}</p>
      <p className="cf-note">{t('cf.intro')}</p>
      {p.error !== '' && <ErrorBanner text={p.error} />}
      {p.phase === 'loading' && (
        <p className="cf-note" role="status">
          {t('cf.loading')}
        </p>
      )}
      {p.phase === 'ready' && p.preview !== null && (
        <PreviewBody
          preview={p.preview}
          changed={p.changed}
          acknowledged={p.acknowledged}
          onAcknowledge={p.onAcknowledge}
        />
      )}
    </DialogShell>
  );
}
