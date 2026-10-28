// ImportDialog.tsx — импорт профилей по прототипу v1.2 (dlgImport,
// FR-UI-114…129): вкладки «Ссылка / QR-код / Файл», двухфазный импорт
// (preview → подтверждение), предупреждения о выброшенных custom-полях,
// авто-детект URL подписки.
import { useCallback, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Profile } from '../gen/lavray_pb';
import { friendlyCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { useModal } from '../hooks/useModal';
import { Icon } from '../components/Icon';

type Tab = 'link' | 'qr' | 'file';

interface Props {
  readonly groupId: bigint;
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // a11y: фокус в первое поле, Esc закрывает, Tab не уходит из диалога.
  // T-05: один раз при открытии (см. hooks/useModal.ts), а не при каждом
  // ререндере родителя.
  useModal(dialogRef, { onClose, autofocusRef: firstFieldRef });

  const looksLikeSubscription = useCallback((raw: string): boolean => {
    const v = raw.trim();
    if (!/^https?:\/\//i.test(v)) return false;
    return !/^[a-z0-9+.-]+:\/\/[^/\s]+@?[^/\s]*:\d+/i.test(v);
  }, []);

  const doPreview = useCallback(
    async (content: string): Promise<void> => {
      setErr('');
      setOk('');
      setBusy(true);
      setPreview(null);
      try {
        const res = await core.profiles.importContent({ content, previewOnly: true });
        setPreview(res.parsedProfiles);
        // Предупреждения — отброшенные опасные custom-поля (LNB-25):
        // показываем, какие поля и у каких профилей вырезаны.
        setWarnings(
          res.customFieldWarnings.map(
            (w) => `#${String(w.profileIndex + 1)}: ${w.droppedFields.join(', ')}`,
          ),
        );
        setHint(res.hint ?? '');
        setIsSubscription(looksLikeSubscription(content));
      } catch (e) {
        setErr(friendlyCoreError(e));
      } finally {
        setBusy(false);
      }
    },
    [core, looksLikeSubscription],
  );

  const doCommit = useCallback(async (): Promise<void> => {
    setErr('');
    setBusy(true);
    try {
      // ID-02 (аудит round 3): custom-поля разрешаем ТОЛЬКО когда были
      // предупреждения и пользователь нажал «Добавить» после их просмотра
      // (LNB-25/FR-UI-257). Иначе двухфазное подтверждение обходилось.
      const res = await core.profiles.importContent({
        content: link,
        targetGroupId: groupId,
        allowCustomFields: warnings.length > 0,
      });
      setOk(tf('toast.subUpdated', { name: String(res.addedProfileIds.length) }));
      onImported();
      onClose();
    } catch (e) {
      setErr(friendlyCoreError(e));
    } finally {
      setBusy(false);
    }
  }, [core, link, groupId, tf, onImported, onClose, warnings.length]);

  const addAsSubscription = useCallback(async (): Promise<void> => {
    setErr('');
    setBusy(true);
    try {
      const autoName = ((): string => {
        try {
          return new URL(link.trim()).host;
        } catch {
          return '';
        }
      })();
      await core.subscriptions.createSubscription({
        name: name.trim() === '' ? autoName : name.trim(),
        url: link.trim(),
      });
      onImported();
      onClose();
    } catch (e) {
      setErr(friendlyCoreError(e));
    } finally {
      setBusy(false);
    }
  }, [core, link, name, onImported, onClose]);

  const readFile = useCallback(
    async (file: File): Promise<void> => {
      setErr('');
      try {
        const text = await file.text();
        setLink(text);
        setTab('link');
        await doPreview(text);
      } catch (e) {
        setErr(friendlyCoreError(e));
      }
    },
    [doPreview],
  );

  return (
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
          {ok !== '' && <div className="toast-ok">{ok}</div>}

          <div className="tabs" role="tablist" aria-label={t('aria.tabs')}>
            {(['link', 'qr', 'file'] as const).map((tb) => (
              <button
                key={tb}
                className={`tab${tab === tb ? ' on' : ''}`}
                role="tab"
                aria-selected={tab === tb}
                tabIndex={tab === tb ? 0 : -1}
                onClick={() => { setTab(tb); }}
              >
                {t(TAB_KEY[tb])}
              </button>
            ))}
          </div>

          {tab === 'link' && (
            <div className="imp-pane" role="tabpanel">
              <div className="imp-col">
                <div className="field">
                  <label className="req" htmlFor="impLink">{t('imp.link')}</label>
                  <input
                    className="input input-mono"
                    id="impLink"
                    ref={firstFieldRef}
                    placeholder="https://… / ss://… / vless://… / happ://…"
                    autoComplete="off"
                    value={link}
                    onChange={(e) => {
                      setLink(e.target.value);
                      setPreview(null);
                    }}
                  />
                </div>

                {preview === null && looksLikeSubscription(link) && (
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
              </div>
            </div>
          )}

          {tab === 'qr' && (
            <div className="imp-pane" role="tabpanel">
              <div className="imp-qr">
                <div className="imp-qr-frame">
                  <Icon name="gauge" />
                </div>
                <p className="t2">{t('imp.qrHint')}</p>
                <div className="imp-qr-acts">
                  <button
                    className="btn btn-sec"
                    onClick={() => {
                      // Область экрана — нативная возможность оболочки;
                      // в браузере недоступна, честно сообщаем.
                      setErr(t('toast.window'));
                    }}
                  >
                    <Icon name="list" />
                    <span>{t('imp.qrRegion')}</span>
                  </button>
                  <label className="btn btn-sec">
                    <Icon name="copy" />
                    <span>{t('imp.qrPaste')}</span>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f === undefined) return;
                        setErr(t('toast.window'));
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {tab === 'file' && (
            <div className="imp-pane" role="tabpanel">
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
                  style={{ display: 'none' }}
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
                  {plural('pl.p', preview.length)}
                </h3>
              </div>
              <ul className="imp-prev-list">
                {preview.slice(0, 8).map((p, i) => (
                  <li key={`${String(p.type)}-${String(i)}`}>
                    <span className="mono">{p.name}</span>
                    <span className="muted mono">
                      {p.address}:{String(p.port)}
                    </span>
                  </li>
                ))}
                {preview.length > 8 && <li className="muted">…</li>}
              </ul>
            </div>
          )}
        </div>

        <div className="dlg-f">
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <span className="flex1" />
          {preview === null && isSubscription && link.trim() !== '' ? (
            <button className="btn btn-pri" disabled={busy} onClick={() => void addAsSubscription()}>
              <Icon name="rss" />
              <span>{t('subs.add')}</span>
            </button>
          ) : null}
          {preview === null ? (
            <button
              className="btn btn-pri"
              disabled={busy || link.trim() === ''}
              onClick={() => void doPreview(link)}
            >
              <Icon name="search" />
              <span>{busy ? t('imp.decrypting') : t('imp.do')}</span>
            </button>
          ) : (
            <button className="btn btn-pri" disabled={busy} onClick={() => void doCommit()}>
              <Icon name="download" />
              <span>{t('imp.prev.add')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
