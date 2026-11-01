// SPDX-License-Identifier: GPL-3.0-only

// BackupRestoreDialog.tsx — «Восстановление из копии» (T-83): файл .lavbk →
// пароль → сводка → опасное подтверждение → замена всех данных → перезагрузка
// состояния приложения. Пока пользователь не подтвердил замену, ядро ничего не
// меняет: проверка (PreviewBackup) только читает файл.
import { useRef, useState } from 'react';
import type { JSX } from 'react';
import type { BackupSummary } from '../../gen/lavray_pb';
import { useCore } from '../../hooks/useCore';
import { useI18n } from '../../hooks/useI18n';
import { backupErrorText } from '../../lib/backupErrors';
import { normalizePassword } from '../../lib/password';
import { readFileBytes } from '../../lib/readFileBytes';
import { ConfirmDialog, DialogShell } from '../dialogs';
import { RestoreDone } from './RestoreDone';
import { RestoreSummary } from './RestoreSummary';

/** Предел размера файла копии — как у ядра (64 МиБ). */
export const MAX_BACKUP_FILE_BYTES = 64 * 1024 * 1024;

interface Props {
  readonly onClose: () => void;
  /** Данные заменены: перечитать состояние приложения (по умолчанию — перезагрузка страницы). */
  readonly onRestored: () => void;
}

interface Picked {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export function BackupRestoreDialog({ onClose, onRestored }: Props): JSX.Element {
  const { t } = useI18n();
  const core = useCore();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [password, setPassword] = useState('');
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<{ readonly needsRestart: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const invalidate = (): void => {
    setSummary(null);
    setErr('');
  };

  const pick = async (file: File | undefined): Promise<void> => {
    invalidate();
    setPicked(null);
    if (file === undefined) return;
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setErr(t('bk.err.tooLarge'));
      return;
    }
    try {
      setPicked({ name: file.name, bytes: await readFileBytes(file) });
    } catch {
      setErr(t('bk.err.read'));
    }
  };

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      await work();
    } catch (e) {
      setErr(backupErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const check = (): Promise<void> =>
    run(async () => {
      if (picked === null) return;
      setSummary(await core.backup.previewBackup({ data: picked.bytes, password: normalizePassword(password) }));
    });

  const replace = (): Promise<void> =>
    run(async () => {
      if (picked === null) return;
      const res = await core.backup.importBackup({
        data: picked.bytes,
        password: normalizePassword(password),
        confirmReplace: true,
      });
      setPassword('');
      setDone({ needsRestart: res.needsAppRestart });
    });

  if (done !== null) return <RestoreDone needsRestart={done.needsRestart} onReload={onRestored} />;

  return (
    <>
      <DialogShell
        titleId="bkRestTitle"
        title={t('bk.restoreTitle')}
        autofocusRef={fileRef}
        dismissOnBackdrop={false}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <span className="flex1" />
            {summary === null ? (
              <button className="btn btn-pri" disabled={busy || picked === null || password === ''} onClick={() => void check()}>
                {busy ? t('bk.checking') : t('bk.check')}
              </button>
            ) : (
              <button
                className="btn btn-danger-solid"
                disabled={busy}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                {busy ? t('bk.restoring') : t('bk.replaceBtn')}
              </button>
            )}
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
            <label htmlFor="bkFile">{t('bk.file')}</label>
            <input
              id="bkFile"
              type="file"
              accept=".lavbk"
              ref={fileRef}
              onChange={(e) => {
                const input = e.target;
                const file = input.files?.[0];
                input.value = ''; // после отмены тот же файл можно выбрать снова
                void pick(file);
              }}
            />
            <p className="cap">{picked?.name ?? t('bk.noFile')}</p>
          </div>
          <div className="field">
            <label htmlFor="bkRestPw">{t('bk.pwRestore')}</label>
            <input
              className="input"
              id="bkRestPw"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                invalidate();
              }}
            />
          </div>
          {summary !== null && (
            <>
              <RestoreSummary summary={summary} />
              <div className="banner banner-warn" role="note">
                <div className="bn-t">{t('bk.replaceWarn')}</div>
              </div>
            </>
          )}
        </div>
      </DialogShell>
      {confirming && (
        <ConfirmDialog
          title={t('bk.confirmTitle')}
          text={t('bk.confirmText')}
          confirmLabel={t('bk.confirmOk')}
          danger
          onConfirm={() => {
            setConfirming(false);
            void replace();
          }}
          onClose={() => {
            setConfirming(false);
          }}
        />
      )}
    </>
  );
}
