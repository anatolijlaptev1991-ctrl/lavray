// SPDX-License-Identifier: GPL-3.0-only

// dialogs.tsx — остальные диалоги прототипа v1.2 одним модулем (оболочка
// DialogShell вынесена в DialogShell.tsx и переэкспортируется отсюда):
// группы серверов, подтверждение, горячие клавиши, лицензии, онбординг.
// Общая оболочка Dialog повторяет .dlg-back/.dlg/.dlg-h/.dlg-b/.dlg-f из DS.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Group_Kind } from '../gen/lavray_pb';
import type { Group } from '../gen/lavray_pb';
import { showCoreError } from '../lib/core';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { useKbdLabel } from '../hooks/useKbdLabel';
import { Icon } from '../components/Icon';
import { DialogShell } from './DialogShell';
import { NekoBoxTile } from './nekobox/NekoBoxTile';
import { loadModes, saveModes } from '../lib/connection';
import { groupDisplayName } from '../lib/groups';
import { LANGUAGES, LANG_NATIVE, type MessageKey } from '../lib/i18n';
import { presetTitle } from '../lib/presets';

export { DialogShell };

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
  const { t, tf, plural } = useI18n();
  const core = useCore();
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // T-12: группа, ожидающая подтверждения удаления (RPC — только после «Удалить»).
  const [pendingDelete, setPendingDelete] = useState<Group | null>(null);
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
              {groupDisplayName(g, t)}
              <small>
                {plural('pl.p', g.profileOrder.length)}
                {g.kind === Group_Kind.SUBSCRIPTION ? ` · ${t('nav.subscriptions')}` : ''}
              </small>
            </span>
            <button
              className="btn btn-ic btn-sm"
              aria-label={`${t('common.edit')} ${groupDisplayName(g, t)}`}
              onClick={() => {
                // В поле — настоящее имя из ядра: перевод туда не подставляем, иначе
                // «ОК» без правок переименовал бы встроенную группу.
                const next = window.prompt(t('common.edit'), g.name);
                if (next !== null) void rename(g, next);
              }}
            >
              <Icon name="settings" />
            </button>
            <button
              className="btn btn-ic btn-sm"
              aria-label={`${t('common.delete')} ${groupDisplayName(g, t)}`}
              disabled={groups.length <= 1}
              onClick={() => { setPendingDelete(g); }}
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
      {/* T-12: подтверждение поверх диалога «Группы» (портал на <body>). */}
      {pendingDelete !== null && (
        <ConfirmDialog
          title={t('grp.delete')}
          text={tf('grp.delConfirm', { name: groupDisplayName(pendingDelete, t), n: pendingDelete.profileOrder.length })}
          confirmLabel={t('grp.delete')}
          danger
          onConfirm={() => {
            const id = pendingDelete.id;
            setPendingDelete(null);
            void remove(id);
          }}
          onClose={() => { setPendingDelete(null); }}
        />
      )}
    </DialogShell>
  );
}

// ============================================================================
// Горячие клавиши (dlgHotkeys)
// ============================================================================

export function HotkeysDialog({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const kbd = useKbdLabel();
  const rows: readonly (readonly [MessageKey, string])[] = [
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
      {rows.map(([key, keycap]) => (
        <div className="hk-row" key={key}>
          <div className="set-txt"><div className="set-l">{t(key)}</div></div>
          <kbd className="kbd">{kbd(keycap)}</kbd>
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
// Онбординг (dlgOnb) — 4 шага: язык → серверы → маршруты/режим → готово
// ============================================================================

export function OnboardingDialog({
  onClose,
  onOpenImport,
  onImported,
}: {
  readonly onClose: () => void;
  readonly onOpenImport: (tab?: 'link' | 'qr' | 'file') => void;
  /** Перенос из NekoBox выполнен: приложение открывает список серверов. */
  readonly onImported?: () => void;
}): JSX.Element {
  const { t, tf, lang, setLanguage } = useI18n();
  const core = useCore();
  const [step, setStep] = useState(1);
  const [presets, setPresets] = useState<{ id: string; displayName: string }[]>([]);
  const [presetId, setPresetId] = useState('');
  // T-73: переключатели стартуют с сохранённых режимов (при повторном
  // открытии мастера из меню), а не с зашитых значений.
  const [sysProxy, setSysProxy] = useState(() => loadModes(window.localStorage).sysProxy);
  const [tunMode, setTunMode] = useState(() => loadModes(window.localStorage).tunMode);
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
  const chosenPreset = presets.find((p) => p.id === presetId);

  // T-73: «Готово» сохраняет выбранные режимы (раньше выбор терялся: в
  // lavray.modes ничего не попадало) и закрывает мастер. «Пропустить» и Esc
  // режимы не трогают.
  const finish = (): void => {
    saveModes(window.localStorage, { sysProxy, tunMode });
    onClose();
  };

  // T-40: мастер на общей оболочке DialogShell (портал на <body>, фокус при
  // открытии, ловушка Tab, Esc = «Пропустить», возврат фокуса). Клик по
  // затемнению мастер не закрывает, как и раньше. Отступы тела не менялись,
  // чтобы diff остался читаемым.
  return (
    <DialogShell
      titleId="onbTitle"
      title={t('onb.title')}
      size="md"
      onClose={onClose}
      dismissOnBackdrop={false}
      footer={
        <>
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
            <button className="btn btn-pri" onClick={finish}>{t('onb.finish')}</button>
          )}
        </>
      }
    >
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
                    onOpenImport('link');
                    onClose();
                  }}
                >
                  <Icon name="plus" />
                  <span>{t('onb.src.link')}</span>
                </button>
                <button
                  className="onb-src onb-src-btn"
                  onClick={() => {
                    onOpenImport('qr');
                    onClose();
                  }}
                >
                  <Icon name="eye" />
                  <span>{t('onb.src.qr')}</span>
                </button>
                <button
                  className="onb-src onb-src-btn"
                  onClick={() => {
                    onOpenImport('file');
                    onClose();
                  }}
                >
                  <Icon name="file" />
                  <span>{t('onb.src.file')}</span>
                </button>
                {/* Перенос из Happ: тот же диалог импорта, но открытый на
                    вкладке ссылки — happ:// расшифровывается ядром. */}
                <button
                  className="onb-src onb-src-btn"
                  title={t('onb.src.happ.d')}
                  onClick={() => {
                    onOpenImport('link');
                    onClose();
                  }}
                >
                  <Icon name="shield" />
                  <span>{t('onb.src.happ')}</span>
                </button>
                {/* Импорт из v2rayN: ссылки/base64/файл экспорта — тот же
                    парсер ImportContent, вкладка «Файл». */}
                <button
                  className="onb-src onb-src-btn"
                  title={t('onb.src.v2ray.d')}
                  onClick={() => {
                    onOpenImport('file');
                    onClose();
                  }}
                >
                  <Icon name="download" />
                  <span>{t('onb.src.v2ray')}</span>
                </button>
                {/* Перенос из NekoBox (T-78): настоящая кнопка, открывает диалог переноса;
                    при найденной установке показывает «Найдено: …» с числами. */}
                <NekoBoxTile {...(onImported === undefined ? {} : { onImported })} />
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
                    {presetTitle(p.id, p.displayName, t)}
                  </button>
                ))}
              </div>
              <h3 className="onb-h" style={{ marginTop: 14 }}>{t('onb.modeTitle')}</h3>
              {/* Как в NekoBox: системный прокси и TUN — ДВА независимых
                  переключателя. Можно включить оба: браузеры пойдут через
                  системный прокси, игры и консоль — через TUN. */}
              <div className="onb-modes">
                <div className="set-row onb-mode-row">
                  <div className="set-txt">
                    <div className="set-l">{t('mode.sys')}</div>
                    <div className="set-d">{t('mode.sys.hint')}</div>
                  </div>
                  <div className="set-ctl">
                    <button
                      className={`sw${sysProxy ? ' on' : ''}`}
                      role="switch"
                      aria-checked={sysProxy}
                      aria-label={t('mode.sys')}
                      onClick={() => { setSysProxy((v) => !v); }}
                    />
                  </div>
                </div>
                <div className="set-row onb-mode-row">
                  <div className="set-txt">
                    <div className="set-l">{t('mode.tun')}</div>
                    <div className="set-d">{t('mode.tun.hint')}</div>
                  </div>
                  <div className="set-ctl">
                    <button
                      className={`sw${tunMode ? ' on' : ''}`}
                      role="switch"
                      aria-checked={tunMode}
                      aria-label={t('mode.tun')}
                      onClick={() => { setTunMode((v) => !v); }}
                    />
                  </div>
                </div>
              </div>
              <p className="hint">{t('mode.both.hint')}</p>
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
                  <dd>
                    {chosenPreset === undefined
                      ? '—'
                      : presetTitle(chosenPreset.id, chosenPreset.displayName, t)}
                  </dd>
                </div>
                <div>
                  <dt>{t('onb.modeTitle')}</dt>
                  <dd>
                    {[sysProxy ? t('mode.sys') : '', tunMode ? t('mode.tun') : '']
                      .filter((x) => x !== '')
                      .join(' + ') || '—'}
                  </dd>
                </div>
              </dl>
            </div>
          )}
    </DialogShell>
  );
}
