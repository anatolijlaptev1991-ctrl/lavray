// SPDX-License-Identifier: GPL-3.0-only

// screen_connection.tsx — «Подключение» по прототипу v1.2 (design/prototype.html
// 1082-1127 + CSS .cx-card/.cx-top/.cx-main/.cx-meta/.cx-qa): карточка
// состояния со знаком «Отражение», пикер сервера, кнопка подключения,
// режим, метаданные сессии, быстрые действия. Данные — от живого ядра.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Icon } from '../components/Icon';
import {
  ConnectMode,
  CoreState,
  SubscriptionProgress_Phase,
  TestLatencyRequest_Mode,
} from '../gen/lavray_pb';
import type { Profile } from '../gen/lavray_pb';
import { useCore, useCoreStatus, useProfiles } from '../hooks/useCore';
import { useTunBlocked } from '../hooks/useTunBlocked';
import { useI18n } from '../hooks/useI18n';
import { CORE_UNAVAILABLE, showCoreError } from '../lib/core';
import { profileTypeLabel } from '../lib/profileType';
import {
  applySystemProxy,
  chooseProfile,
  coreModeFor,
  disconnectAll,
  loadModes,
  loadSelectedProfileId,
  reconnect,
  saveModes,
  saveSelectedProfileId,
} from '../lib/connection';
import { ConnRight } from '../components/ConnRight';
import { TunAdminNotice } from '../components/TunAdminNotice';
import { ImportDialog } from '../components/ImportDialog';
import { ProfileMenu } from '../components/ProfileMenu';
import type { ProfileMenuAnchor } from '../components/ProfileMenu';
import { geoName } from '../lib/geo';
import { presetRuleCount, presetTitle } from '../lib/presets';



export function ConnectionScreen(): JSX.Element {
  const { t, tf, lang } = useI18n();
  const core = useCore();
  const status = useCoreStatus();
  const { profiles, refresh } = useProfiles('');
  // Режимы независимы (NekoBox-паритет): TUN — туннель, системный
  // прокси — дополнительный канал для браузеров. Выбор запоминается.
  const [sysProxy, setSysProxy] = useState(() => loadModes(window.localStorage).sysProxy);
  const [tunMode, setTunMode] = useState(() => loadModes(window.localStorage).tunMode);
  const [busy, setBusy] = useState(false);
  // error — ошибки быстрых действий (тест, подписки), под карточкой;
  // connError — подключение, режимы, выбор сервера: верхний баннер с «Повторить».
  const [error, setError] = useState('');
  const [connError, setConnError] = useState('');
  // Выбранный сервер запоминается (localStorage, как и режимы): раньше выбор
  // жил в состоянии экрана и терялся при уходе со страницы, а Ctrl+D
  // подключал первый сервер списка.
  const [pickedId, setPickedId] = useState<bigint | null>(() =>
    loadSelectedProfileId(window.localStorage),
  );
  const [menuAnchor, setMenuAnchor] = useState<ProfileMenuAnchor | null>(null);
  const pickRef = useRef<HTMLButtonElement | null>(null);
  const [sessionSec, setSessionSec] = useState(0);
  const rayId = `ray${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // Быстрые действия прототипа (.cx-qa): тест задержек, импорт, обновление
  // подписок. Раньше все три просто перезапрашивали список профилей —
  // кнопки-обманки, не делавшие обещанного.
  const [busyAction, setBusyAction] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [subs, setSubs] = useState<readonly { id: bigint; name: string }[]>([]);
  // Активный пресет маршрутов — для карточки «Качество связи».
  const [preset, setPreset] = useState<{ id: string; displayName: string; rules: number } | null>(
    null,
  );

  const ready = status.state === CoreState.CONNECTED;
  const connecting =
    status.state === CoreState.CONNECTING || status.state === CoreState.RECONNECTING;
  // Ядро в ошибке (старт не удался) либо пропало: когда опрос не удался,
  // useCoreStatus кладёт в lastError код core.unavailable. Пока ядро не
  // ответило ни разу (coreVersion пуст — холодный старт), это не ошибка:
  // первые секунды приложение просто ждёт ядро.
  const coreError = status.lastError ?? '';
  const coreFailed =
    status.state === CoreState.ERROR || (coreError !== '' && status.coreVersion !== '');
  // T-46: TUN выбран, а прав администратора нет — подключаться бессмысленно.
  const tunBlocked = useTunBlocked(tunMode);

  // Список подписок нужен для быстрого действия «Обновить подписки»:
  // обновление идёт по groupId, а не глобально.
  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const res = await core.subscriptions.listSubscriptions({});
        setSubs(res.groups.map((s) => ({ id: s.id, name: s.name })));
      } catch {
        /* ядро недоступно — кнопка будет disabled */
      }
    })();
  }, [core]);

  // Активный пресет маршрутов: имя и число правил для карточки «Качество
  // связи» (прототип: hlPreset + hlRules).
  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const res = await core.routing.listPresets({});
        const active0 = res.presets.find((p) => p.id === res.activePresetId);
        if (active0 === undefined) return;
        setPreset({
          id: active0.id,
          displayName: active0.displayName,
          rules: presetRuleCount(active0),
        });
      } catch {
        /* пресеты недоступны — карточка покажет «—» */
      }
    })();
  }, [core]);

  /** «Проверить серверы»: задержка TCP по всем профилям. */
  const testAll = useCallback(async (): Promise<void> => {
    if (profiles.length === 0) return;
    setBusyAction('test');
    setActionMsg('');
    setError('');
    try {
      const ids = profiles.map((p) => p.id);
      const stream = core.profiles.testLatency(
        { profileIds: ids, mode: TestLatencyRequest_Mode.TCP_PING },
        {},
      );
      let ok = 0;
      let total = 0;
      for await (const res of stream) {
        total = res.total;
        if ((res.result?.lastError ?? '') === '') ok += 1;
      }
      setActionMsg(tf('test.progress', { done: ok, total }));
      refresh();
    } catch (e) {
      setError(showCoreError(e, t));
    } finally {
      setBusyAction('');
    }
  }, [core, profiles, refresh, t, tf]);

  /** «Обновить подписки»: последовательное обновление всех групп. */
  const refreshSubs = useCallback(async (): Promise<void> => {
    if (subs.length === 0) return;
    setBusyAction('subs');
    setActionMsg('');
    setError('');
    let done = 0;
    try {
      for (const s of subs) {
        const stream = core.subscriptions.updateSubscription({
          groupId: s.id,
          confirmDestructive: false,
        });
        for await (const ev of stream) {
          if (ev.phase === SubscriptionProgress_Phase.DONE) done += 1;
        }
      }
      setActionMsg(tf('subs.updatedN', { n: done }));
      refresh();
    } catch (e) {
      setError(showCoreError(e, t));
    } finally {
      setBusyAction('');
    }
  }, [core, subs, refresh, t, tf]);

  // Ядро в простое присылает статус БЕЗ active_profile_id (поле optional в
  // proto): на клиенте оно `undefined`, а не 0n. Раньше `undefined !== 0n`
  // давало «профиль не найден» и экран «Пока нет серверов» при живом списке.
  const runningId = status.activeProfileId ?? 0n;
  // Пока соединение есть, карточка показывает запущенный сервер; иначе — тот,
  // что выбран в меню (или первый, если выбора не было).
  const active = useMemo(
    () => profiles.find((p) => p.id === runningId) ?? chooseProfile(profiles, pickedId),
    [profiles, pickedId, runningId],
  );
  // Блок с кнопкой нужен и когда соединение есть, а профиля нет в списке:
  // иначе «Отключить» пропадает вместе с профилем.
  const showMain = active !== undefined || ready;

  // D9 (аудит round 2): таймер считается от started_at_ms ядра, а не от
  // монтирования экрана — иначе при переходе между разделами время
  // обнулялось.
  //
  // Откат системного прокси после падения прошлой сессии делает оболочка
  // один раз в setup() (shell/src/main.rs). Здесь его вызывать нельзя:
  // компонент монтируется при каждом переходе на «Подключение», и откат
  // снимал бы прокси посреди активного туннеля (снимок удалялся — вернуть
  // настройки пользователя было бы уже нечем).
  useEffect(() => {
    if (!ready) {
      setSessionSec(0);
      return undefined;
    }
    const started = Number(status.startedAtMs ?? 0n);
    const tick = (): void => {
      setSessionSec(started > 0 ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return (): void => {
      clearInterval(id);
    };
  }, [ready, status.startedAtMs]);

  // Системный прокси ставится оболочкой (Rust): WinINET/gsettings/
  // networksetup + снимок прежних настроек для восстановления. В браузере
  // режим недоступен — веб-панель не управляет ОС пользователя.
  const applySys = useCallback(
    async (on: boolean): Promise<boolean> => {
      try {
        await applySystemProxy(on, status.inbound?.port ?? 2080);
        return true;
      } catch (e) {
        if (e instanceof Error && e.message === 'mode.sys.nativeOnly') {
          setConnError(t('mode.sys.nativeOnly'));
        } else {
          setConnError(showCoreError(e, t));
        }
        return false;
      }
    },
    [status.inbound, t],
  );

  const toggle = useCallback(async (): Promise<void> => {
    setBusy(true);
    setConnError('');
    try {
      if (ready) {
        // Прокси ОС снимается даже при сбое RPC (disconnectAll — try/finally):
        // иначе браузеры остаются на мёртвом порту.
        await disconnectAll(core);
      } else if (active !== undefined) {
        await core.core.connect({
          profileId: active.id,
          mode: coreModeFor({ sysProxy, tunMode }),
        });
        // Системный прокси — независимо от TUN (оба режима сразу).
        await applySys(sysProxy);
      } else {
        setConnError(t('cx.empty.t'));
      }
    } catch (e) {
      setConnError(showCoreError(e, t));
    } finally {
      setBusy(false);
    }
  }, [core, ready, active, t, sysProxy, tunMode, applySys]);

  // Переключатели режимов: выбор запоминается, а при активном соединении
  // применяется сразу — раньше он лишь писался в localStorage и до следующего
  // подключения ничего не менял. Не применилось — переключатель возвращается.
  const changeSysProxy = useCallback(
    async (next: boolean): Promise<void> => {
      const prev = { sysProxy, tunMode };
      setSysProxy(next);
      saveModes(window.localStorage, { sysProxy: next, tunMode });
      if (!ready) return;
      setBusy(true);
      setConnError('');
      setActionMsg('');
      if (await applySys(next)) {
        setActionMsg(t('toast.modeApplied'));
      } else {
        setSysProxy(prev.sysProxy);
        saveModes(window.localStorage, prev);
      }
      setBusy(false);
    },
    [ready, sysProxy, tunMode, applySys, t],
  );

  // TUN ядро на лету не включает: перезапуск соединения с новым режимом.
  const changeTun = useCallback(
    async (next: boolean): Promise<void> => {
      const prev = { sysProxy, tunMode };
      setTunMode(next);
      saveModes(window.localStorage, { sysProxy, tunMode: next });
      const running = status.mode === ConnectMode.TUN;
      if (!ready || runningId === 0n || running === next) return;
      setBusy(true);
      setConnError('');
      setActionMsg('');
      try {
        await reconnect({
          core,
          next: { profileId: runningId, modes: { sysProxy, tunMode: next } },
          prev: { profileId: runningId, modes: { sysProxy, tunMode: running } },
        });
        setActionMsg(t('toast.modeApplied'));
      } catch (e) {
        setTunMode(prev.tunMode);
        saveModes(window.localStorage, prev);
        setConnError(showCoreError(e, t));
      } finally {
        setBusy(false);
      }
    },
    [core, ready, runningId, status.mode, sysProxy, tunMode, t],
  );

  // Состояние карточки (прототип renderConn): ошибка важнее остальных.
  const phase = coreFailed ? 'err' : ready ? 'on' : connecting ? 'connecting' : 'off';
  const stateLabel = t(`conn.state.${phase}`);
  const stateSub = t(`conn.state.${phase}.sub`);
  const typeLabel = active === undefined ? '' : profileTypeLabel(active.type, t);
  const bannerText =
    connError !== ''
      ? connError
      : coreError === CORE_UNAVAILABLE
        ? t('core.unavailable')
        : coreError;

  const session = `${String(Math.floor(sessionSec / 60)).padStart(2, '0')}:${String(
    sessionSec % 60,
  ).padStart(2, '0')}`;

  /**
   * Выбор сервера в меню: запоминается; при активном соединении переключает
   * его на выбранный сервер (Disconnect → Connect с теми же режимами).
   */
  const pickProfile = useCallback(
    async (p: Profile): Promise<void> => {
      setPickedId(p.id);
      saveSelectedProfileId(window.localStorage, p.id);
      if (!ready || runningId === 0n || p.id === runningId) return;
      // Режим ядра остаётся прежним: берём фактический, а не переключатель.
      const modes = { sysProxy, tunMode: status.mode === ConnectMode.TUN };
      setBusy(true);
      setConnError('');
      try {
        await reconnect({
          core,
          next: { profileId: p.id, modes },
          prev: { profileId: runningId, modes },
        });
      } catch (e) {
        // Остались на прежнем сервере (или без соединения): выбор возвращаем.
        setPickedId(runningId);
        saveSelectedProfileId(window.localStorage, runningId);
        setConnError(showCoreError(e, t));
      } finally {
        setBusy(false);
      }
    },
    [core, ready, runningId, sysProxy, status.mode, t],
  );

  const closeMenu = useCallback((restoreFocus: boolean): void => {
    setMenuAnchor(null);
    if (restoreFocus) pickRef.current?.focus();
  }, []);

  // «Повторить»: если соединения нет — подключаемся к выбранному серверу ещё раз;
  // если оно есть (сорвалась смена сервера или режима) — достаточно скрыть ошибку.
  const retry = useCallback((): void => {
    setConnError('');
    if (!ready) void toggle();
  }, [ready, toggle]);

  return (
    <div className="conn2">
      {(coreFailed || connError !== '') && (
        <div
          className="banner banner-err"
          id="connBanner"
          role="alert"
          style={{ gridColumn: '1 / -1', marginBottom: 0 }}
        >
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">
            <b>{t('core.err.t')}</b>
            {bannerText !== '' && <span>{bannerText}</span>}
          </div>
          <div className="bn-acts">
            <button className="btn btn-sec btn-sm" id="cbRetry" disabled={busy} onClick={retry}>
              {t('err.retry')}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              id="cbDiag"
              onClick={() => {
                window.location.hash = 'screen=diag&tab=checks';
              }}
            >
              {t('cx.toDiag')}
            </button>
          </div>
        </div>
      )}
      <div className="card cx-card" id="stateCard" data-conn={phase === 'connecting' ? 'mid' : phase}>
        <div className="cx-top">
          <div className="ray" aria-hidden="true">
            {/* id градиентов уникальны (useId): на экране несколько знаков,
                а id в SVG глобальны — повтор ломал закраску луча. */}
            <svg className="lgA" viewBox="0 0 64 64" aria-hidden="true">
              <defs>
                <linearGradient
                  id={rayId}
                  gradientUnits="userSpaceOnUse"
                  x1="23"
                  y1="9"
                  x2="49"
                  y2="43"
                >
                  <stop offset="0" className="lr-a" stopOpacity=".3" />
                  <stop offset=".5" className="lr-a" />
                  <stop offset="1" className="lr-b" />
                </linearGradient>
              </defs>
              <g transform="translate(-4.5 1.5)">
                <path
                  className="a-beam"
                  pathLength="100"
                  d="M23 13V43H45"
                  strokeWidth="8"
                  style={{ stroke: `url(#${rayId})` }}
                />
                <path className="a-mirror" d="M14.5 43L23 51.5" />
                <circle className="a-photon" cx="55.5" cy="43" r="3.6" />
              </g>
            </svg>
          </div>
          <div className="cx-state">
            <div className="conn-state" id="connState" role="status" aria-live="polite">
              {stateLabel}
            </div>
            <div className="conn-state-sub">{stateSub}</div>
          </div>
        </div>

        {showMain ? (
          <div className="cx-main" id="cxMain">
            <div className="cx-server">
              <span className="cap" id="srvLbl">
                {t('srv.current')}
              </span>
              <button
                className="srv-pick"
                ref={pickRef}
                aria-haspopup="menu"
                aria-expanded={menuAnchor !== null}
                aria-describedby="srvLbl"
                disabled={busy || connecting || profiles.length === 0}
                onClick={(e) => {
                  if (menuAnchor !== null) {
                    setMenuAnchor(null);
                    return;
                  }
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenuAnchor({ left: r.left, bottom: r.bottom, width: r.width });
                }}
              >
                <span className="srv-top">
                  <span className="srv-name">
                    {active?.name ?? status.activeProfileName ?? '—'}
                  </span>
                  {active !== undefined && (
                    <span className={`badge bt-${typeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '')}`}>
                      {typeLabel}
                    </span>
                  )}
                </span>
                <span className="srv-addr mono">
                  {active !== undefined ? `${active.address}:${String(active.port)}` : ''}
                </span>
                <span className="srv-chg">
                  <span>{t('srv.change')}</span>
                  <Icon name="chevron-down" size={16} />
                </span>
              </button>
            </div>

            <button
              className={`btn btn-lg ${ready ? 'btn-danger-solid' : 'btn-pri'}`}
              onClick={() => void toggle()}
              disabled={busy || connecting || status.state === CoreState.DISCONNECTING || (tunBlocked && !ready)}
            >
              <Icon name="plug" />
              {ready ? t('conn.disconnect') : t('conn.connect')}
            </button>

            <div className="cx-mode">
              <span className="cap" id="modeLbl">
                {t('mode.title')}
              </span>
              {/* Два независимых тумблера как в NekoBox: подключение
                  режима определяется тем, что включено (TUN приоритетнее
                  для туннеля, системный прокси — дополнительно). */}
              <div className="cx-modes">
                <div className="cx-mode-row">
                  <span className="cx-mode-l">{t('mode.sys')}</span>
                  <button
                    className={`sw${sysProxy ? ' on' : ''}`}
                    role="switch"
                    aria-checked={sysProxy}
                    aria-label={t('mode.sys')}
                    disabled={busy || connecting}
                    onClick={() => {
                      void changeSysProxy(!sysProxy);
                    }}
                  />
                </div>
                <div className="cx-mode-row">
                  <span className="cx-mode-l">{t('mode.tun')}</span>
                  <button
                    className={`sw${tunMode ? ' on' : ''}`}
                    role="switch"
                    aria-checked={tunMode}
                    aria-label={t('mode.tun')}
                    disabled={busy || connecting}
                    onClick={() => {
                      void changeTun(!tunMode);
                    }}
                  />
                </div>
              </div>
              <p className="hint">{t('mode.both.hint')}</p>
              {tunBlocked && <TunAdminNotice />}
            </div>

            <dl className="cx-meta">
              <div>
                <dt>{t('conn.session')}</dt>
                <dd className="mono">{session}</dd>
              </div>
              <div>
                <dt>{t('conn.ip')}</dt>
                <dd className="mono">—</dd>
              </div>
              <div>
                <dt>{t('conn.country')}</dt>
                <dd>{active === undefined || active.geo === '' ? '—' : geoName(active.geo, lang)}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="cx-empty" id="cxEmpty">
            <p className="cx-empty-t">{t('cx.empty.t')}</p>
            <p className="cx-empty-d">{t('cx.empty.d')}</p>
          </div>
        )}

        <div className="cx-qa">
          <button
            className="btn btn-ghost btn-sm"
            disabled={busyAction !== '' || profiles.length === 0}
            onClick={() => {
              void testAll();
            }}
          >
            <Icon name="gauge" />
            {t('quick.test')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setImportOpen(true);
            }}
          >
            <Icon name="plus" />
            {t('quick.import')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={busyAction !== '' || subs.length === 0}
            onClick={() => {
              void refreshSubs();
            }}
          >
            <Icon name="rss" />
            {t('quick.subs')}
          </button>
        </div>

        {actionMsg !== '' && <p className="hint">{actionMsg}</p>}

        {error !== '' && (
          <div className="banner banner-err" role="alert">
            {error}
          </div>
        )}
      </div>
      <ConnRight
        connected={ready}
        latencyMs={active?.testResult?.latencyMs}
        presetName={preset === null ? '—' : presetTitle(preset.id, preset.displayName, t)}
        presetRules={preset?.rules ?? 0}
      />
      {menuAnchor !== null && (
        <ProfileMenu
          anchor={menuAnchor}
          profiles={profiles}
          selectedId={active?.id}
          onSelect={(p) => {
            void pickProfile(p);
          }}
          onAllServers={() => {
            window.location.hash = 'screen=servers&tab=profiles';
          }}
          onClose={closeMenu}
        />
      )}
      {importOpen && (
        <ImportDialog
          onClose={() => { setImportOpen(false); }}
          onImported={() => {
            setImportOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
