// SPDX-License-Identifier: GPL-3.0-only

// ImportDialog.tsx — импорт профилей по прототипу v1.2 (dlgImport,
// FR-UI-114…129): вкладки «Ссылка / QR-код / Файл», двухфазный импорт
// (preview → подтверждение), предупреждения о выброшенных custom-полях,
// авто-детект URL подписки.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import { ImportContentResponse_ContentKind } from '../gen/lavray_pb';
import type { Profile } from '../gen/lavray_pb';
import { CORE_UNAVAILABLE, friendlyCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { useModal } from '../hooks/useModal';
import { Icon } from '../components/Icon';
import { importLogWarnings } from '../lib/importWarnings';
import { onTablistKeyDown } from '../lib/tabs';
import { UnsupportedBadge } from './servers/UnsupportedBadge';
import { QrTab } from './import/QrTab';

type Tab = 'link' | 'qr' | 'file';

interface Props {
  /**
   * Группа назначения. Не задана (быстрое действие «Подключения», меню
   * титлбара, онбординг) — ядро кладёт профили в «Default»; передавать 0 нельзя.
   */
  readonly groupId?: bigint | undefined;
  /** Вкладка, открываемая при показе (онбординг ведёт в нужный источник). */
  readonly initialTab?: Tab;
  readonly onClose: () => void;
  readonly onImported: () => void;
}

const TAB_KEY: Record<Tab, 'imp.tab.link' | 'imp.tab.qr' | 'imp.tab.file'> = {
  link: 'imp.tab.link',
  qr: 'imp.tab.qr',
  file: 'imp.tab.file',
};

const TABS: readonly Tab[] = ['link', 'qr', 'file'];
/** Схемы ссылок, которые понимает импорт (FR-UI-120) и happ://: по ним плашка узнаёт ссылку в буфере. */
const CLIP_LINK = /^(?:vless|vmess|trojan|ss|hysteria2|hy2|tuic|socks(?:4a?|5)?|https?|happ|nekoray):\/\/\S+/i;
const HAPP_LINK = /^happ:\/\//i;

/** «vless://…a1b2»: схема и последние 4 символа; остальное в плашке не показываем. */
function maskLink(raw: string): string {
  const scheme = /^([a-z0-9+.-]+):\/\//i.exec(raw)?.[1] ?? '';
  return `${scheme}://…${raw.slice(-4)}`;
}

export function ImportDialog({ groupId, initialTab = 'link', onClose, onImported }: Props): JSX.Element {
  const { t, tf, plural } = useI18n();
  const core = useCore();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<Profile[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hint, setHint] = useState('');
  const [isSubscription, setIsSubscription] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  // Ссылка из буфера обмена (плашка «Вставить?») и детали ошибки Happ (карточка).
  const [clip, setClip] = useState<string | null>(null);
  const [happErr, setHappErr] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // a11y: фокус в первое поле, Esc закрывает, Tab не уходит из диалога.
  // T-05: один раз при открытии (см. hooks/useModal.ts), а не при каждом
  // ререндере родителя.
  useModal(dialogRef, { onClose, autofocusRef: firstFieldRef });

  // Плашка «В буфере обмена ссылка — вставить?»: буфер читаем один раз, когда
  // открывается окно (текст imp.clipNote); без Clipboard API или без доступа — молча.
  useEffect(() => {
    const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
    if (clipboard === undefined) return;
    void (async (): Promise<void> => {
      try {
        const raw = (await clipboard.readText()).trim();
        if (raw.length <= 100_000 && CLIP_LINK.test(raw)) setClip(raw);
      } catch {
        /* доступ к буферу запрещён: плашку не показываем */
      }
    })();
  }, []);


  const doPreview = useCallback(
    async (content: string): Promise<void> => {
      setErr('');
      setOk('');
      setHappErr(null);
      setBusy(true);
      setPreview(null);
      try {
        const res = await core.profiles.importContent({ content, previewOnly: true });
        setPreview(res.parsedProfiles);
        // Предупреждения — отброшенные опасные custom-поля (LNB-25):
        // показываем, какие поля и у каких профилей вырезаны.
        setWarnings([
          ...res.customFieldWarnings.map(
            (w) => `#${String(w.profileIndex + 1)}: ${w.droppedFields.join(', ')}`,
          ),
          ...importLogWarnings(res.log, tf), // например, XHTTP: импорт есть, подключения нет
        ]);
        setHint(res.hint ?? '');
        // Подписку определяет ядро (в том числе Happ-ссылку и URL с портом).
        setIsSubscription(res.kind === ImportContentResponse_ContentKind.SUBSCRIPTION_URL);
      } catch (e) {
        const message = friendlyCoreError(e);
        if (HAPP_LINK.test(content.trim()) && message !== CORE_UNAVAILABLE) {
          // Ссылку целиком в детали не кладём: только размер (прототип #happErrD).
          const size = new TextEncoder().encode(content.trim()).length;
          setHappErr(`${message}\nsource: happ://… · ${String(size)} B`);
        } else {
          setErr(message);
        }
      } finally {
        setBusy(false);
      }
    },
    [core, tf],
  );

  const copyHappDetails = useCallback(async (): Promise<void> => {
    if (happErr === null) return;
    try {
      await navigator.clipboard.writeText(happErr);
      setOk(t('err.copied'));
    } catch (e) {
      setErr(friendlyCoreError(e));
    }
  }, [happErr, t]);

  const doCommit = useCallback(async (): Promise<void> => {
    setErr('');
    setBusy(true);
    try {
      // T-08B: клиент ничего не разрешает — custom-поля импортированных профилей
      // остаются неподтверждёнными, пока их не подтвердят через diff (CustomBadge).
      const res = await core.profiles.importContent({
        content: link,
        ...(groupId === undefined ? {} : { targetGroupId: groupId }),
      });
      setOk(tf('toast.imported', { n: res.addedProfileIds.length }));
      onImported();
      onClose();
    } catch (e) {
      setErr(friendlyCoreError(e));
    } finally {
      setBusy(false);
    }
  }, [core, link, groupId, tf, onImported, onClose]);

  const addAsSubscription = useCallback(async (): Promise<void> => {
    setErr('');
    setBusy(true);
    try {
      // Пустое имя ядро заменяет хостом ссылки; happ://crypt… оно расшифровывает.
      await core.subscriptions.createSubscription({ name: name.trim(), url: link.trim() });
      onImported();
      onClose();
    } catch (e) {
      setErr(friendlyCoreError(e));
    } finally {
      setBusy(false);
    }
  }, [core, link, name, onImported, onClose]);

  /** Текст из файла или QR-кода идёт тем же путём, что вставленная ссылка: вкладка «Ссылка» и предпросмотр. */
  const acceptText = useCallback(
    async (text: string): Promise<void> => {
      setLink(text);
      setTab('link');
      await doPreview(text);
    },
    [doPreview],
  );

  const readFile = useCallback(
    async (file: File): Promise<void> => {
      setErr('');
      try {
        await acceptText(await file.text());
      } catch (e) {
        setErr(friendlyCoreError(e));
      }
    },
    [acceptText],
  );

  // T-06: портал на <body> (см. DialogShell) — диалог не зависит от transform
  // предков внутри экрана.
  return createPortal(
    <div
      className="dlg-back open"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="dlg dlg-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="impTitle"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="dlg-h">
          <h2 id="impTitle">{t('imp.title')}</h2>
          <button className="btn btn-ic btn-sm" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="dlg-b">
          {err !== '' && (
            <div className="banner banner-err" role="alert" style={{ marginBottom: 12 }}>
              <span className="ic"><Icon name="alert" /></span>
              <div className="bn-t">{err}</div>
            </div>
          )}
          {ok !== '' && <div className="toast-ok" role="status">{ok}</div>}

          <div
            className="tabs"
            role="tablist"
            aria-label={t('aria.tabs')}
            onKeyDown={(e) => {
              // T-38: ←/→/Home/End переключают вкладку и переносят на неё фокус.
              onTablistKeyDown(e, (i) => {
                const next = TABS[i];
                if (next !== undefined) setTab(next);
              });
            }}
          >
            {TABS.map((tb) => (
              <button
                key={tb}
                id={`impTab-${tb}`}
                className={`tab${tab === tb ? ' on' : ''}`}
                role="tab"
                aria-selected={tab === tb}
                aria-controls={tab === tb ? `impPane-${tb}` : undefined}
                tabIndex={tab === tb ? 0 : -1}
                onClick={() => { setTab(tb); }}
              >
                {t(TAB_KEY[tb])}
              </button>
            ))}
          </div>

          {tab === 'link' && (
            <div className="imp-pane" role="tabpanel" id="impPane-link" aria-labelledby="impTab-link">
              <div className="imp-col">
                {clip !== null && link === '' && (
                  <div className="banner banner-warn" style={{ margin: 0 }}>
                    <span className="ic"><Icon name="copy" /></span>
                    <div className="bn-t">
                      <span>{tf('imp.clip', { link: maskLink(clip) })}</span>
                      <span className="cap">{t('imp.clipNote')}</span>
                    </div>
                    <div className="bn-acts">
                      <button
                        className="btn btn-sec btn-sm"
                        onClick={() => {
                          setLink(clip);
                          setClip(null);
                          setPreview(null);
                          firstFieldRef.current?.focus();
                        }}
                      >
                        {t('imp.clipPaste')}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setClip(null);
                        }}
                      >
                        {t('imp.clipHide')}
                      </button>
                    </div>
                  </div>
                )}
                <div className="field">
                  <label className="req" htmlFor="impLink">{t('imp.link')}</label>
                  <input
                    className="input input-mono"
                    id="impLink"
                    ref={firstFieldRef}
                    placeholder="https://… / ss://… / vless://…"
                    autoComplete="off"
                    value={link}
                    onChange={(e) => {
                      setLink(e.target.value);
                      setPreview(null);
                      setIsSubscription(false);
                      setHappErr(null);
                    }}
                  />
                </div>

                {preview !== null && isSubscription && (
                  <div className="field">
                    <label htmlFor="impName">{t('imp.name')}</label>
                    <input
                      className="input"
                      id="impName"
                      autoComplete="off"
                      value={name}
                      onChange={(e) => { setName(e.target.value); }}
                    />
                  </div>
                )}

                {warnings.length > 0 && (
                  <div className="banner banner-warn">
                    <span className="ic"><Icon name="alert" /></span>
                    <div className="bn-t">
                      {warnings.map((w, i) => (
                        <div key={`${String(i)}-${w.slice(0, 24)}`}>{w}</div>
                      ))}
                    </div>
                  </div>
                )}

                {hint !== '' && <p className="cap">{hint}</p>}
                <p className="cap">{t('imp.hint')}</p>

                {happErr !== null && (
                  <div className="errcard" role="alert">
                    <div className="t">
                      <span className="ic"><Icon name="alert" /></span>
                      <span>{t('imp.happErrT')}</span>
                    </div>
                    <span className="ctx">{t('imp.happErrCtx')}</span>
                    <div className="d">{happErr}</div>
                    <div className="acts">
                      <button className="btn btn-sec btn-sm" onClick={() => void copyHappDetails()}>
                        <Icon name="copy" />
                        <span>{t('err.copyDetails')}</span>
                      </button>
                      <button className="btn btn-pri btn-sm" disabled={busy} onClick={() => void doPreview(link)}>
                        {t('err.retry')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'qr' && <QrTab onDecoded={(text) => { void acceptText(text); }} />}

          {tab === 'file' && (
            <div className="imp-pane" role="tabpanel" id="impPane-file" aria-labelledby="impTab-file">
              <label
                className="imp-drop"
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f !== undefined) void readFile(f);
                }}
              >
                <Icon name="file" />
                <span className="imp-drop-t">{t('imp.drop')}</span>
                <span className="cap">{t('imp.dropOr')}</span>
                <input
                  type="file"
                  accept=".txt,.json,.yaml,.yml,.conf,*/*"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f !== undefined) void readFile(f);
                  }}
                />
              </label>
              <p className="cap">{t('imp.fileHint')}</p>
            </div>
          )}

          {preview !== null && (
            <div className="card" style={{ background: 'var(--surface2)', marginTop: 12 }}>
              <div className="card-h" style={{ marginBottom: 8 }}>
                <span className="ic"><Icon name="search" /></span>
                <h3 style={{ fontSize: '.875rem', fontWeight: 600 }}>
                  {isSubscription ? t('imp.prev.subUrl') : plural('pl.p', preview.length)}
                </h3>
              </div>
              {!isSubscription && (
                <ul className="imp-prev-list">
                  {preview.slice(0, 8).map((p, i) => (
                    <li key={`${String(p.type)}-${String(i)}`}>
                      <span className="mono">{p.name}</span>
                      <UnsupportedBadge reason={p.unsupportedReason} />
                      <span className="muted mono">
                        {p.address}:{String(p.port)}
                      </span>
                    </li>
                  ))}
                  {preview.length > 8 && <li className="muted">…</li>}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="dlg-f">
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <span className="flex1" />
          {preview === null ? (
            <button
              className="btn btn-pri"
              disabled={busy || link.trim() === ''}
              onClick={() => void doPreview(link)}
            >
              <Icon name="search" />
              <span>{busy ? t('imp.decrypting') : t('imp.do')}</span>
            </button>
          ) : isSubscription ? (
            <button className="btn btn-pri" disabled={busy} onClick={() => void addAsSubscription()}>
              <Icon name="rss" />
              <span>{t('subs.add')}</span>
            </button>
          ) : (
            <button className="btn btn-pri" disabled={busy} onClick={() => void doCommit()}>
              <Icon name="download" />
              <span>{t('imp.prev.add')}</span>
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
