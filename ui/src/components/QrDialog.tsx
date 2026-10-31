// SPDX-License-Identifier: GPL-3.0-only

// QrDialog.tsx — QR-код со ссылкой профиля, чтобы перенести сервер на телефон.
// Ссылку отдаёт ядро (ExportLinks, как «Копировать ссылку»); код рисуется
// локально, ссылка никуда не уходит. Ссылка почти всегда содержит ключи, и
// диалог предупреждает, что код нельзя показывать посторонним.
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Profile } from '../gen/lavray_pb';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { showCoreError } from '../lib/core';
import { qrMatrix, QrTooLongError } from '../lib/qr/encode';
import type { QrMatrix } from '../lib/qr/encode';
import { linkHasSecret } from '../lib/qr/secretWarning';
import { DialogShell } from './dialogs';
import { Icon } from './Icon';
import { QrCanvas } from './QrCanvas';

interface Props {
  readonly profile: Profile;
  readonly onClose: () => void;
}

/** Что показывает диалог: ссылка получена и закодирована, не влезла в код, её нет или запрос упал. */
type View =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly link: string; readonly matrix: QrMatrix }
  | { readonly kind: 'tooLong'; readonly link: string }
  | { readonly kind: 'noLink' }
  | { readonly kind: 'failed'; readonly error: unknown };

/** Ссылка → вид диалога; не помещающаяся в код ссылка остаётся доступной для копирования. */
function viewOfLink(link: string): View {
  try {
    return { kind: 'ready', link, matrix: qrMatrix(link) };
  } catch (e) {
    if (e instanceof QrTooLongError) return { kind: 'tooLong', link };
    return { kind: 'failed', error: e };
  }
}

/** Запрашивает ссылку профиля у ядра и строит по ней вид диалога. */
function useShareView(profileId: bigint): View {
  const core = useCore();
  const [view, setView] = useState<View>({ kind: 'loading' });
  useEffect(() => {
    const ac = new AbortController();
    void (async (): Promise<void> => {
      let next: View;
      try {
        const res = await core.profiles.exportLinks({ ids: [profileId] });
        const link = res.links[0];
        next = link === undefined || link === '' ? { kind: 'noLink' } : viewOfLink(link);
      } catch (e) {
        next = { kind: 'failed', error: e };
      }
      if (!ac.signal.aborted) setView(next);
    })();
    return (): void => {
      ac.abort();
    };
  }, [core, profileId]);
  return view;
}

interface BodyProps {
  readonly view: View;
  readonly name: string;
  readonly note: string;
  readonly problem: string;
}

/** Содержимое диалога: код или причина, почему его нет, имя профиля, предупреждение о ключах. */
function QrBody({ view, name, note, problem }: BodyProps): JSX.Element {
  const { t, tf } = useI18n();
  const link = view.kind === 'ready' || view.kind === 'tooLong' ? view.link : '';
  return (
    <div className="qr-box">
      {view.kind === 'loading' && <p className="cap" role="status">{t('qr.loading')}</p>}
      {view.kind === 'ready' && <QrCanvas matrix={view.matrix} label={tf('qr.alt', { name })} />}
      {view.kind === 'tooLong' && <p className="cap" role="alert">{t('qr.tooLong')}</p>}
      {view.kind === 'noLink' && <p className="cap" role="alert">{t('srv.noLink')}</p>}
      {view.kind === 'failed' && <p className="cap" role="alert">{showCoreError(view.error, t)}</p>}
      <div className="mono t3" title={name} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </div>
      {link !== '' && linkHasSecret(link) && (
        <div className="banner banner-warn" style={{ margin: 0 }}>
          <span className="ic"><Icon name="alert" /></span>
          <div className="bn-t">{t('qr.secretWarn')}</div>
        </div>
      )}
      {problem !== '' && <div className="banner banner-err" role="alert"><div className="bn-t">{problem}</div></div>}
      {note !== '' && <div className="toast-ok" role="status">{note}</div>}
    </div>
  );
}

export function QrDialog({ profile, onClose }: Props): JSX.Element {
  const { t } = useI18n();
  const view = useShareView(profile.id);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const link = view.kind === 'ready' || view.kind === 'tooLong' ? view.link : '';

  const copy = useCallback(async (): Promise<void> => {
    setNote('');
    setProblem('');
    try {
      await navigator.clipboard.writeText(link);
      setNote(t('toast.copied'));
    } catch (e) {
      setProblem(showCoreError(e, t));
    }
  }, [link, t]);

  return (
    <DialogShell
      titleId="qrTitle"
      title={t('qr.title')}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>
          <span className="flex1" />
          <button className="btn btn-pri" disabled={link === ''} onClick={() => void copy()}>
            <Icon name="copy" />
            <span>{t('common.copyLink')}</span>
          </button>
        </>
      }
    >
      <QrBody view={view} name={profile.name} note={note} problem={problem} />
    </DialogShell>
  );
}
