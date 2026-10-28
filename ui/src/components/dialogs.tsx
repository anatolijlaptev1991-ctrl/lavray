// dialogs.tsx — остальные диалоги прототипа v1.2 одним модулем:
// группы серверов, подтверждение, горячие клавиши, лицензии, резервная
// копия, сохранение пресета, онбординг, экспорт журнала, переход на бета.
// Общая оболочка Dialog повторяет .dlg-back/.dlg/.dlg-h/.dlg-b/.dlg-f из DS.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { JSX } from 'react';
import { Group_Kind } from '../gen/lavray_pb';
import type { Group } from '../gen/lavray_pb';
import { showCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { Icon } from '../components/Icon';
import { LANGUAGES, LANG_NATIVE } from '../lib/i18n';

interface ShellProps {
  readonly titleId: string;
  readonly title: string;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly onClose: () => void;
  readonly autofocusRef?: React.RefObject<HTMLElement | null>;
}

/** Оболочка диалога: focus-trap, Esc, клик по фону. */
export function DialogShell({
  titleId,
  title,
  size = 'sm',
  children,
  footer,
  onClose,
  autofocusRef,
}: ShellProps): JSX.Element {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (autofocusRef?.current ?? rootRef.current)?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = rootRef.current;
      if (root === null) return;
      const nodes = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (first === undefined || last === undefined) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, autofocusRef, t]);

  return (
    <div
      className="dlg-back open"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`dlg dlg-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={rootRef}
        tabIndex={-1}
      >
        <div className="dlg-h">
          <h2 id={titleId}>{title}</h2>
          <button className="btn btn-ic btn-sm" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dlg-b">{children}</div>
        {footer !== undefined && <div className="dlg-f">{footer}</div>}
      </div>
    </div>
  );
}



// ============================================================================
// Подтверждение (dlgConfirm)
// ============================================================================

interface ConfirmProps {
  readonly title: string;
  readonly text: string;
  readonly confirmLabel: string;
  readonly danger?: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

export function ConfirmDialog({ title, text, confirmLabel, danger = false, onConfirm, onClose }: ConfirmProps): JSX.Element {
  const { t } = useI18n();
  return (
    <DialogShell
      titleId="cfTitle"
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <span className="flex1" />
          <button
            className={danger ? 'btn btn-danger-solid' : 'btn btn-pri'}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ fontSize: '.8125rem' }}>{text}</p>
    </DialogShell>
  );
}

// ============================================================================
// Группы серверов (dlgGroups) — FR-UI-102…113
// ============================================================================

interface GroupsDialogProps {
  readonly onClose: () => void;
  readonly onChanged: () => void;
}

export function GroupsDialog({ onClose, onChanged }: GroupsDialogProps): JSX.Element {
  const { t, plural } = useI18n();
  const core = useCore();
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const createRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await core.profiles.listGroups({});
      setGroups(res.groups);
    } catch (e) {
      setErr(showCoreError(e, t));
    }
  }, [core, t]);

  useEffect(() => {
    void reload();
  }, [reload, t]);

  const create = useCallback(async (): Promise<void> => {
    if (name.trim() === '') return;
    setBusy(true);
    setErr('');
    try {
      await core.profiles.createGroup({
        group: { name: name.trim(), kind: Group_Kind.BASIC },
      });
      setName('');
      await reload();
      onChanged();
    } catch (e) {
      setErr(showCoreError(e, t));
    } finally {
      setBusy(false);
    }
  }, [core, name, reload, onChanged, t]);

  const remove = useCallback(
    async (id: bigint): Promise<void> => {
      setErr('');
      try {
        await core.profiles.deleteGroup({ id });
        await reload();
        onChanged();
      } catch (e) {
        setErr(showCoreError(e, t));
      }
    },
    [core, reload, onChanged, t],
  );

  const rename = useCallback(
    async (g: Group, next: string): Promise<void> => {
      if (next.trim() === '' || next === g.name) return;
      setErr('');
      try {
        await core.profiles.updateGroup({ group: { ...g, name: next.trim() } });
        await reload();
        onChanged();
      } catch (e) {
        setErr(showCoreError(e, t));
      }
    },
    [core, reload, onChanged, t],
  );

  return (
    <DialogShell
      titleId="grpDlgTitle"
      title={t('grp.title')}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>
          <span className="flex1" />
          <button className="btn btn-sec" onClick={() => { createRef.current?.focus(); }}>
            <Icon name="plus" />
            <span>{t('grp.create')}</span>
          </button>
        </>
      }
    >
      {err !== '' && (
        <div className="banner banner-err" role="alert" style={{ marginBottom: 10 }}>
          <span className="ic"><Icon name="alert" /></span>
          <div className="bn-t">{err}</div>
        </div>
      )}
      <div className="grp-dlg-list">
        {groups.map((g) => (
          <div className="grp-dlg-row" key={String(g.id)}>
            <span className="n">
              {g.name}
              <small>
                {plural('pl.p', g.profileOrder.length)}
                {g.kind === Group_Kind.SUBSCRIPTION ? ` · ${t('nav.subscriptions')}` : ''}
              </small>
            </span>
            <button
              className="btn btn-ic btn-sm"
              aria-label={`${t('common.edit')} ${g.name}`}
              onClick={() => {
                const next = window.prompt(t('common.edit'), g.name);
                if (next !== null) void rename(g, next);
              }}
            >
              <Icon name="settings" />
            </button>
            <button
              className="btn btn-ic btn-sm"
              aria-label={`${t('common.delete')} ${g.name}`}
              disabled={groups.length <= 1}
              onClick={() => { void remove(g.id); }}
            >
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>
      <div className="grp-dlg-new">
        <input
          className="input"
          ref={createRef}
          placeholder={t('grp.name')}
          value={name}
          aria-label={t('grp.name')}
          onChange={(e) => { setName(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
        />
        <button className="btn btn-pri btn-sm" disabled={busy || name.trim() === ''} onClick={() => void create()}>
          {t('grp.create')}
        </button>
      </div>
    </DialogShell>
  );
}

// ============================================================================
// Горячие клавиши (dlgHotkeys)
// ============================================================================

export function HotkeysDialog({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const rows: readonly (readonly [string, string])[] = [
    ['hk.search', 'K'],
    ['hk.toggle', 'D'],
    ['hk.close', 'Esc'],
    ['hk.settings', ','],
  ];
  return (
    <DialogShell titleId="hkTitle" title={t('sec.hotkeys')} size="sm" onClose={onClose}
      footer={
        <>
          <span className="flex1" />
          <button className="btn btn-sec" onClick={onClose}>{t('common.close')}</button>
        </>
      }
    >
      {rows.map(([key, kbd]) => (
        <div className="hk-row" key={key}>
          <div className="set-txt"><div className="set-l">{t(key as never)}</div></div>
          <kbd className="kbd">{kbd}</kbd>
        </div>
      ))}
    </DialogShell>
  );
}

// ============================================================================
// Лицензии и компоненты (dlgLicenses)
// ============================================================================

export function LicensesDialog({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  return (
    <DialogShell titleId="licTitle2" title={t('lic.title')} size="sm" onClose={onClose}
      footer={
        <>
          <span className="flex1" />
          <button className="btn btn-sec" onClick={onClose}>{t('common.close')}</button>
        </>
      }
    >
      <ul className="lic-list">
        <li>{t('lic.app')}</li>
        <li>{t('lic.core')}</li>
        <li>{t('lic.ui')}</li>
        <li>{t('lic.fonts')}</li>
        <li>
          {t('lic.geo')} <span className="cap">{t('lic.geoTbd')}</span>
        </li>
      </ul>
    </DialogShell>
  );
}

// ============================================================================
// Экспорт журнала (dlgLogExport)
// ============================================================================

export function LogExportDialog({
  sampleBefore,
  sampleAfter,
  onExport,
  onClose,
}: {
  readonly sampleBefore: string;
  readonly sampleAfter: string;
  readonly onExport: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <DialogShell titleId="leTitle" title={t('log.exportT')} size="md" onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <span className="flex1" />
          <button className="btn btn-pri" onClick={onExport}>
            <Icon name="copy" />
            <span>{t('log.exportBtn')}</span>
          </button>
        </>
      }
    >
      <p style={{ fontSize: '.8125rem' }}>{t('log.exportD')}</p>
      <div className="le-samples">
        <div>
          <span className="cap">{t('log.before')}</span>
          <div className="le-sample mono">{sampleBefore}</div>
        </div>
        <div>
          <span className="cap">{t('log.after')}</span>
          <div className="le-sample mono">{sampleAfter}</div>
        </div>
      </div>
    </DialogShell>
  );
}

// ============================================================================
// Сохранение пресета (dlgPresetSave)
// ============================================================================

export function PresetSaveDialog({
  onSave,
  onClose,
}: {
  readonly onSave: (name: string) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const ref = useRef<HTMLInputElement | null>(null);
  return (
    <DialogShell
      titleId="psTitle"
      title={t('rt.saveAs')}
      size="sm"
      onClose={onClose}
      autofocusRef={ref}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <span className="flex1" />
          <button className="btn btn-pri" disabled={name.trim() === ''} onClick={() => { onSave(name.trim()); }}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="req" htmlFor="psName">{t('rt.presetName')}</label>
        <input
          className="input"
          id="psName"
          ref={ref}
          autoComplete="off"
          value={name}
          onChange={(e) => { setName(e.target.value); }}
        />
      </div>
    </DialogShell>
  );
}


// ============================================================================
// Онбординг (dlgOnb) — 4 шага: язык → серверы → маршруты/режим → готово
// ============================================================================

export function OnboardingDialog({
  onClose,
  onOpenImport,
}: {
  readonly onClose: () => void;
  readonly onOpenImport: () => void;
}): JSX.Element {
  const { t, tf, lang, setLanguage } = useI18n();
  const core = useCore();
  const [step, setStep] = useState(1);
  const [presets, setPresets] = useState<{ id: string; displayName: string }[]>([]);
  const [presetId, setPresetId] = useState('');
  const [mode, setMode] = useState<'sys' | 'tun'>('sys');
  const [err, setErr] = useState('');

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const res = await core.routing.listPresets({});
        setPresets(res.presets.map((p) => ({ id: p.id, displayName: p.displayName })));
        setPresetId(res.activePresetId);
      } catch {
        /* ядро недоступно — шаг покажет пусто */
      }
    })();
  }, [core, t]);

  const applyPreset = useCallback(
    async (id: string): Promise<void> => {
      setPresetId(id);
      try {
        await core.routing.activatePreset({ id });
      } catch (e) {
        setErr(showCoreError(e, t));
      }
    },
    [core, t],
  );

  return (
    <div className="dlg-back open" role="presentation">
      <div className="dlg dlg-md" role="dialog" aria-modal="true" aria-labelledby="onbTitle">
        <div className="dlg-h">
          <h2 id="onbTitle">{t('onb.title')}</h2>
          <button className="btn btn-ic btn-sm" aria-label={t('onb.skip')} title={t('onb.skip')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dlg-b">
          <p className="t2">{t('onb.sub')}</p>
          <p className="cap" style={{ marginTop: 4 }}>
            {tf('onb.stepOf', { n: step, total: 4 })}
          </p>
          <ol className="onb-steps">
            {[1, 2, 3, 4].map((n) => (
              <li key={n} className={`onb-step${n === step ? ' on' : ''}${n < step ? ' done' : ''}`} />
            ))}
          </ol>

          {err !== '' && (
            <div className="banner banner-err" role="alert" style={{ marginBottom: 10 }}>
              <span className="ic"><Icon name="alert" /></span>
              <div className="bn-t">{err}</div>
            </div>
          )}

          {step === 1 && (
            <div className="onb-pane">
              <div className="onb-lang-grid" role="radiogroup" aria-label={t('set.lang')}>
                {LANGUAGES.map((l) => (
                  <button
                    key={l}
                    className={`onb-lang${lang === l ? ' on' : ''}`}
                    role="radio"
                    aria-checked={lang === l}
                    onClick={() => { setLanguage(l); }}
                  >
                    <span className="n">{LANG_NATIVE[l]}</span>
                    <span className="c">{l.toUpperCase()}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="onb-pane">
              <h3 className="onb-h">{t('onb.serverTitle')}</h3>
              <p className="cap">{t('onb.serverDesc')}</p>
              <div className="onb-src-grid">
                <button
                  className="onb-src onb-src-btn"
                  onClick={() => {
                    onOpenImport();
                    onClose();
                  }}
                >
                  <Icon name="plus" />
                  <span>{t('onb.src.link')}</span>
                </button>
                <span className="onb-src muted">
                  <Icon name="rss" />
                  <span>{t('onb.src.qr')}</span>
                </span>
                <span className="onb-src muted">
                  <Icon name="file" />
                  <span>{t('onb.src.file')}</span>
                </span>
                <span className="onb-src muted">
                  <Icon name="layers" />
                  <span>{t('onb.src.neko')}</span>
                </span>
              </div>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => { setStep(3); }}>
                {t('onb.later')}
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="onb-pane">
              <h3 className="onb-h">{t('onb.presetTitle')}</h3>
              <p className="cap">{t('onb.presetDesc')}</p>
              <div className="onb-preset-grid" role="radiogroup" aria-label={t('onb.presetTitle')}>
                {presets.slice(0, 6).map((p) => (
                  <button
                    key={p.id}
                    className={`onb-preset${presetId === p.id ? ' on' : ''}`}
                    role="radio"
                    aria-checked={presetId === p.id}
                    onClick={() => { void applyPreset(p.id); }}
                  >
                    {p.displayName}
                  </button>
                ))}
              </div>
              <h3 className="onb-h" style={{ marginTop: 14 }}>{t('onb.modeTitle')}</h3>
              <div className="seg seg-wide" role="radiogroup" aria-label={t('onb.modeTitle')}>
                <button
                  role="radio"
                  aria-checked={mode === 'sys'}
                  className={mode === 'sys' ? 'on' : ''}
                  onClick={() => { setMode('sys'); }}
                >
                  {t('mode.sys')}
                </button>
                <button
                  role="radio"
                  aria-checked={mode === 'tun'}
                  className={mode === 'tun' ? 'on' : ''}
                  onClick={() => { setMode('tun'); }}
                >
                  {t('mode.tun')}
                </button>
              </div>
              <p className="hint">{mode === 'sys' ? t('mode.sys.hint') : t('mode.tun.hint')}</p>
            </div>
          )}

          {step === 4 && (
            <div className="onb-pane">
              <h3 className="onb-h">{t('onb.doneTitle')}</h3>
              <dl className="onb-summary">
                <div>
                  <dt>{t('set.lang')}</dt>
                  <dd>{LANG_NATIVE[lang]}</dd>
                </div>
                <div>
                  <dt>{t('nav.routing')}</dt>
                  <dd>{presets.find((p) => p.id === presetId)?.displayName ?? '—'}</dd>
                </div>
                <div>
                  <dt>{t('onb.modeTitle')}</dt>
                  <dd>{mode === 'sys' ? t('mode.sys') : t('mode.tun')}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
        <div className="dlg-f">
          <button className="btn btn-ghost" onClick={onClose}>{t('onb.skip')}</button>
          <span className="flex1" />
          {step > 1 && (
            <button className="btn btn-sec" onClick={() => { setStep((v) => v - 1); }}>
              {t('common.back')}
            </button>
          )}
          {step < 4 ? (
            <button className="btn btn-pri" onClick={() => { setStep((v) => v + 1); }}>
              {t('common.next')}
            </button>
          ) : (
            <button className="btn btn-pri" onClick={onClose}>{t('common.next')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
