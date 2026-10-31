// SPDX-License-Identifier: GPL-3.0-only

// BackupExportDialog.tsx — «Создать резервную копию» (T-83, прототип dlgBackup):
// пароль, повтор, галочка «без пароля не восстановить». Ядро шифрует копию
// (Argon2id + XChaCha20-Poly1305), файл сохраняется через «Сохранить как»
// оболочки (lib/saveFile.ts, расширение .lavbk). Пароль живёт только в состоянии
// диалога и уходит в ядро один раз.
import { useRef, useState } from 'react';
import type { JSX } from 'react';
import { useCore } from '../../hooks/useCore';
import { useI18n } from '../../hooks/useI18n';
import { backupErrorText } from '../../lib/backupErrors';
import { MIN_PASSWORD_CHARS, normalizePassword, passwordIssue, passwordsMatch } from '../../lib/password';
import { saveFile } from '../../lib/saveFile';
import { DialogShell } from '../dialogs';

interface Props {
  readonly onClose: () => void;
  /** Файл сохранён. */
  readonly onSaved: () => void;
}

export function BackupExportDialog({ onClose, onSaved }: Props): JSX.Element {
  const { t, tf } = useI18n();
  const core = useCore();
  const pwRef = useRef<HTMLInputElement | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const issue = pw === '' ? null : passwordIssue(pw);
  const mismatch = pw2 !== '' && !passwordsMatch(pw, pw2);
  const canSave = !busy && pw !== '' && issue === null && pw2 !== '' && !mismatch && ack;

  const save = async (): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      const res = await core.backup.exportBackup({ password: normalizePassword(pw) });
      const name = res.suggestedName.replace(/\.lavbk$/i, '') || 'lavray-backup';
      let result: Awaited<ReturnType<typeof saveFile>>;
      try {
        result = await saveFile(name, 'lavbk', res.data);
      } catch {
        setErr(t('bk.err.save'));
        return;
      }
      if (result === 'saved') onSaved();
    } catch (e) {
      setErr(backupErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      titleId="bkExpTitle"
      title={t('bk.exportTitle')}
      autofocusRef={pwRef}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <span className="flex1" />
          <button className="btn btn-pri" disabled={!canSave} onClick={() => void save()}>
            {busy ? t('bk.exporting') : t('bk.save')}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {err !== '' && (
          <div className="banner banner-err" role="alert">
            <div className="bn-t">{err}</div>
          </div>
        )}
        <div className="field">
          <label htmlFor="bkPw">{t('bk.pw')}</label>
          <input
            className="input"
            id="bkPw"
            type="password"
            ref={pwRef}
            autoComplete="new-password"
            aria-invalid={issue !== null}
            aria-describedby="bkPwHint"
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
            }}
          />
          <p className="cap" id="bkPwHint" role={issue === null ? undefined : 'alert'}>
            {issue === 'short' && tf('bk.pwShort', { n: MIN_PASSWORD_CHARS })}
            {issue === 'long' && t('bk.pwLong')}
            {issue === null && tf('bk.pwHint', { n: MIN_PASSWORD_CHARS })}
          </p>
        </div>
        <div className="field">
          <label htmlFor="bkPw2">{t('bk.pw2')}</label>
          <input
            className="input"
            id="bkPw2"
            type="password"
            autoComplete="new-password"
            aria-invalid={mismatch}
            aria-describedby={mismatch ? 'bkPwMismatch' : undefined}
            value={pw2}
            onChange={(e) => {
              setPw2(e.target.value);
            }}
          />
          {mismatch && (
            <p className="cap" id="bkPwMismatch" role="alert">
              {t('bk.mismatch')}
            </p>
          )}
        </div>
        <label className="cf-ack">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => {
              setAck(e.target.checked);
            }}
          />
          <span>{t('bk.ack')}</span>
        </label>
      </div>
    </DialogShell>
  );
}
