// screen_connection.tsx — «Подключение» по прототипу v1.2 (design/prototype.html
// 1082-1127 + CSS .cx-card/.cx-top/.cx-main/.cx-meta/.cx-qa): карточка
// состояния со знаком «Отражение», пикер сервера, кнопка подключения,
// режим, метаданные сессии, быстрые действия. Данные — от живого ядра.
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Icon } from '../components/Icon';
import { CoreState } from '../gen/lavray_pb';
import { useCore, useCoreStatus, useProfiles } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import { friendlyCoreError, showCoreError } from '../lib/core';
import { applySystemProxy, coreModeFor, loadModes, saveModes } from '../lib/connection';
import { TrafficGraph } from '../components/TrafficGraph';
import { geoName } from '../lib/geo';



export function ConnectionScreen(): JSX.Element {
  const { t, lang } = useI18n();
  const core = useCore();
  const status = useCoreStatus();
  const { profiles, refresh } = useProfiles('');
  // Режимы независимы (NekoBox-паритет): TUN — туннель, системный
  // прокси — дополнительный канал для браузеров. Выбор запоминается.
  const [sysProxy, setSysProxy] = useState(() => loadModes(window.localStorage).sysProxy);
  const [tunMode, setTunMode] = useState(() => loadModes(window.localStorage).tunMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pickedId, setPickedId] = useState<bigint | null>(null);
  const [sessionSec, setSessionSec] = useState(0);
  const rayId = `ray${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const ready = status.state === CoreState.CONNECTED;
  const connecting = status.state === CoreState.CONNECTING;

  const active = useMemo(() => {
    if (pickedId !== null) return profiles.find((p) => p.id === pickedId);
    if (status.activeProfileId !== 0n) {
      return profiles.find((p) => p.id === status.activeProfileId);
    }
    return profiles[0];
  }, [profiles, pickedId, status.activeProfileId]);

  // D9 (аудит round 2): таймер считается от started_at_ms ядра, а не от
  // монтирования экрана — иначе при переходе между разделами время
  // обнулялось.
  // При старте оболочка откатывает системный прокси, если прошлая сессия
  // упала с включённым прокси (FR-UI-259).
  useEffect(() => {
    const isTauri = (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
    if (!isTauri) return;
    void (async (): Promise<void> => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('recover_system_proxy');
      } catch {
        /* ядро ещё не поднялось */
      }
    })();
  }, []);

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
    async (on: boolean): Promise<void> => {
      try {
        await applySystemProxy(on, status.inbound?.port ?? 2080);
      } catch (e) {
        if (e instanceof Error && e.message === 'mode.sys.nativeOnly') {
          setError(t('mode.sys.nativeOnly'));
          return;
        }
        setError(showCoreError(e, t));
      }
    },
    [status.inbound, t],
  );

  const toggle = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      if (ready) {
        await core.core.disconnect({});
        await applySys(false);
      } else if (active !== undefined) {
        await core.core.connect({
          profileId: active.id,
          mode: coreModeFor({ sysProxy, tunMode }),
        });
        // Системный прокси — независимо от TUN (оба режима сразу).
        await applySys(sysProxy);
      } else {
        setError(t('cx.empty.t'));
      }
    } catch (e) {
      setError(friendlyCoreError(e));
    } finally {
      setBusy(false);
    }
  }, [core, ready, active, t, sysProxy, tunMode, applySys]);

  const stateLabel = ready
    ? t('conn.state.on')
    : connecting
      ? t('conn.state.connecting')
      : status.state === CoreState.ERROR
        ? t('conn.state.err')
        : t('conn.state.off');
  const stateSub = ready
    ? t('conn.state.on.sub')
    : connecting
      ? t('conn.state.connecting.sub')
      : status.state === CoreState.ERROR
        ? t('conn.state.err.sub')
        : t('conn.state.off.sub');

  const session = `${String(Math.floor(sessionSec / 60)).padStart(2, '0')}:${String(
    sessionSec % 60,
  ).padStart(2, '0')}`;

  const nextProfile = (): void => {
    if (profiles.length < 2) return;
    const idx = profiles.findIndex((p) => p.id === active?.id);
    const next = profiles[(idx + 1) % profiles.length];
    if (next !== undefined) setPickedId(next.id);
  };

  return (
    <div className="conn2">
      <div className="card cx-card" id="stateCard" data-conn={ready ? 'on' : 'off'}>
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

        {active !== undefined ? (
          <div className="cx-main" id="cxMain">
            <div className="cx-server">
              <span className="cap" id="srvLbl">
                {t('srv.current')}
              </span>
              <button
                className="srv-pick"
                aria-haspopup="menu"
                aria-expanded="false"
                aria-describedby="srvLbl"
                onClick={nextProfile}
              >
                <span className="srv-top">
                  <span className="srv-name">{active.name}</span>
                  <span className="badge">{active.type}</span>
                </span>
                <span className="srv-addr mono">
                  {active.address}:{String(active.port)}
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
              disabled={busy || connecting}
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
                    onClick={() => {
                      const next = !sysProxy;
                      setSysProxy(next);
                      saveModes(window.localStorage, { sysProxy: next, tunMode });
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
                    onClick={() => {
                      const next = !tunMode;
                      setTunMode(next);
                      saveModes(window.localStorage, { sysProxy, tunMode: next });
                    }}
                  />
                </div>
              </div>
              <p className="hint">{t('mode.both.hint')}</p>
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
                <dd>{active.geo === '' ? '—' : geoName(active.geo, lang)}</dd>
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
            onClick={() => {
              refresh();
            }}
          >
            <Icon name="refresh" />
            {t('quick.test')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              refresh();
            }}
          >
            <Icon name="plus" />
            {t('quick.import')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              refresh();
            }}
          >
            <Icon name="gauge" />
            {t('quick.subs')}
          </button>
        </div>

        {error !== '' && (
          <div className="banner banner-err" role="alert">
            {error}
          </div>
        )}
      </div>
      <TrafficGraph active={ready} />
    </div>
  );
}
