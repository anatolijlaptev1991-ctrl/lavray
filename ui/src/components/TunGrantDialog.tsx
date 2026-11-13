// SPDX-License-Identifier: GPL-3.0-only

// TunGrantDialog.tsx — диалог режима TUN на Linux. Прав администратора процессу
// не нужно: ядру выдаётся разрешение управлять сетью (file capabilities), система
// один раз спрашивает пароль, приложение не перезапускается. Виды по ответу
// `tun_access_state`: `grant` (кнопка «Выдать разрешение»), `manual` (готовая
// команда и «Скопировать»), `unavailable` (причина, например AppImage).
import { useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';
import type { GrantOutcome, TunGate } from '../lib/tunAccess';
import type { MessageKey } from '../lib/i18n';
import { DialogShell } from './DialogShell';

export type GrantDialogGate = Exclude<TunGate, { kind: 'ready' } | { kind: 'elevate' }>;

interface Props {
  readonly gate: GrantDialogGate;
  readonly onClose: () => void;
  /** Выдать разрешение (и перезапустить ядро, если надо). Ошибка — `Error` с кодом оболочки. */
  readonly onGrant: () => Promise<GrantOutcome>;
  /** «Проверить снова» после ручной команды. */
  readonly onRecheck: () => void;
}

type Notice = { readonly kind: 'cancelled' } | { readonly kind: 'error'; readonly code: string };

const UNAVAILABLE_KEY: Readonly<Record<string, MessageKey>> = {
  appimage: 'tun.grant.appimage',
  nosuid: 'tun.grant.nosuid',
  restart: 'tun.grant.restartFailed',
};

/** Код ошибки оболочки → готовая фраза, если она есть. */
function failureKey(code: string): MessageKey | null {
  if (code === 'not_grantable') return 'tun.grant.notGrantable';
  if (code === 'core_restart_timeout') return 'tun.grant.restartFailed';
  return null;
}

function copyToClipboard(text: string, done: () => void): void {
  const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
  if (clipboard !== undefined) void clipboard.writeText(text).then(done);
}

function Body({ gate, busy, notice }: { gate: GrantDialogGate; busy: boolean; notice: Notice | null }): JSX.Element {
  const { t } = useI18n();
  const failure = notice?.kind === 'error' ? failureKey(notice.code) : null;
  return (
    <>
      {gate.kind === 'grant' && <p>{t('tun.grant.d')}</p>}
      {gate.kind === 'manual' && (
        <>
          <p>{t('tun.grant.manual.d')}</p>
          <pre className="mono" id="tunGrantCommand" style={{ whiteSpace: 'pre-wrap', userSelect: 'all' }}>
            {gate.command}
          </pre>
        </>
      )}
      {gate.kind === 'unavailable' && <p role="alert">{t(UNAVAILABLE_KEY[gate.reason] ?? 'tun.grant.unavail')}</p>}
      {busy && (
        <p className="hint" role="status">
          {t('tun.grant.busy')}
        </p>
      )}
      {notice?.kind === 'cancelled' && (
        <p className="hint" role="status">
          {t('tun.grant.cancelled')}
        </p>
      )}
      {notice?.kind === 'error' && (
        <div className="banner banner-err" role="alert">
          {failure !== null ? t(failure) : `${t('tun.grant.failed')}: ${notice.code.replace(/^failed:\s*/, '')}`}
        </div>
      )}
    </>
  );
}

function Footer(p: Props & { busy: boolean; onPress: () => void }): JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const { gate } = p;
  return (
    <>
      <button className="btn btn-ghost" onClick={p.onClose}>
        {t(gate.kind === 'unavailable' ? 'common.close' : 'common.cancel')}
      </button>
      <span className="flex1" />
      {gate.kind === 'grant' && (
        <button className="btn btn-pri" id="tunGrant" disabled={p.busy} aria-busy={p.busy} autoFocus onClick={p.onPress}>
          {t('tun.grant.ok')}
        </button>
      )}
      {gate.kind === 'manual' && (
        <>
          <button
            className="btn btn-sec"
            id="tunGrantCopy"
            onClick={() => {
              copyToClipboard(gate.command, () => {
                setCopied(true);
              });
            }}
          >
            {t(copied ? 'tun.grant.copied' : 'tun.grant.copy')}
          </button>
          <button className="btn btn-pri" id="tunGrantRecheck" onClick={p.onRecheck}>
            {t('tun.grant.recheck')}
          </button>
        </>
      )}
    </>
  );
}

export function TunGrantDialog(props: Props): JSX.Element {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const grant = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      if ((await props.onGrant()) === 'cancelled') setNotice({ kind: 'cancelled' });
    } catch (e) {
      setNotice({ kind: 'error', code: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };

  return (
    <DialogShell
      titleId="tunDlgTitle"
      title={t('tun.dlg.t')}
      size="sm"
      onClose={props.onClose}
      footer={
        <Footer
          {...props}
          busy={busy}
          onPress={() => {
            void grant();
          }}
        />
      }
    >
      <Body gate={props.gate} busy={busy} notice={notice} />
    </DialogShell>
  );
}
