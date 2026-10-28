// WindowChrome.tsx — собственный хром окна Tauri (DS §3: per-OS chrome).
// Прототип рисует титлбар с кнопками окна (.caps-win/.caps-linux/.tl-mac);
// окно Tauri создаётся без системной рамки, иначе заголовок дублируется
// (системный «LAVRay» + бренд в шапке) и остаётся мёртвая полоса.
//
// В веб-режиме (браузерная панель) хром не нужен: там титлбар скрыт CSS.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Icon } from './Icon';
import { useI18n } from '../hooks/useI18n';

interface WinApi {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onResized: (cb: () => void) => Promise<() => void>;
}

/**
 * Управление окном идёт через команды оболочки (`window_*` в shell/src/
 * main.rs), а не через `@tauri-apps/api/window`: у безрамочного окна
 * JS-команды требуют ACL-разрешений на каждое действие, и любое
 * отсутствующее право молча оставляет кнопку мёртвой.
 */
async function invokeShell<T>(cmd: string): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd);
}

/** Ленивая загрузка window API: в браузере модуль не нужен вовсе. */
async function loadWinApi(): Promise<WinApi | null> {
  if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === undefined) {
    return null;
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  return {
    minimize: async (): Promise<void> => {
      await invokeShell<null>('window_minimize');
    },
    toggleMaximize: async (): Promise<void> => {
      await invokeShell<boolean>('window_toggle_maximize');
    },
    close: async (): Promise<void> => {
      await invokeShell<null>('window_hide');
    },
    isMaximized: () => invokeShell<boolean>('window_is_maximized'),
    // События окна приходят через JS-шину и ACL не требуют.
    onResized: async (cb) => w.onResized(cb),
  };
}

export interface WindowChromeProps {
  /** ОС из адаптера: 'windows' | 'macos' | 'linux' | 'web'. */
  readonly os: string;
}

/** Адаптер отдаёт 'windows'/'macos', прототип — 'win'/'mac'. */
function normOs(os: string): 'win' | 'mac' | 'linux' | 'other' {
  if (os === 'windows' || os === 'win') return 'win';
  if (os === 'macos' || os === 'mac') return 'mac';
  if (os === 'linux') return 'linux';
  return 'other';
}

/**
 * Кнопки управления окном. Windows — «— □ ✕» справа (ширина 46 px по
 * прототипу), Linux — круглая кнопка закрытия справа, macOS — «светофор»
 * слева. Окно создаётся без системной рамки (tauri.conf.json), поэтому
 * эти кнопки — единственные: системный заголовок не дублируется.
 */
export function WindowChrome({ os }: WindowChromeProps): JSX.Element | null {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);
  const platform = normOs(os);

  useEffect(() => {
    // ref вместо локального `let`: линтер не сужает тип в асинхронном
    // замыкании и не считает проверку мёртвой веткой.
    const alive = { current: true };
    let unlisten: (() => void) | undefined;
    void (async (): Promise<void> => {
      const api = await loadWinApi();
      if (api === null || !alive.current) return;
      setMaximized(await api.isMaximized());
      unlisten = await api.onResized(() => {
        void api.isMaximized().then((m) => {
          if (alive.current) setMaximized(m);
        });
      });
    })();
    return (): void => {
      alive.current = false;
      unlisten?.();
    };
  }, []);

  if (platform === 'other') return null;

  const act = (fn: (api: WinApi) => Promise<void>): void => {
    void (async (): Promise<void> => {
      const api = await loadWinApi();
      if (api !== null) await fn(api);
    })();
  };

  // macOS: системный «светофор» рисуется самой ОС только у декорированного
  // окна; у безрамочного его нет — рисуем свои кнопки тем же видом.
  if (platform === 'mac') {
    return (
      <span className="tl-mac" aria-hidden="false">
        <button
          className="tl r"
          aria-label={t('tb.close')}
          title={t('tb.close')}
          onClick={() => {
            act((a) => a.close());
          }}
        />
        <button
          className="tl y"
          aria-label={t('tb.min')}
          title={t('tb.min')}
          onClick={() => {
            act((a) => a.minimize());
          }}
        />
        <button
          className="tl g"
          aria-label={t('tb.max')}
          title={t('tb.max')}
          onClick={() => {
            act((a) => a.toggleMaximize());
          }}
        />
      </span>
    );
  }

  if (platform === 'linux') {
    return (
      <div className="caps-linux">
        <button
          className="cap-btn cap-round"
          aria-label={t('tb.close')}
          title={t('tb.close')}
          onClick={() => {
            act((a) => a.close());
          }}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="caps-win">
      <button
        className="cap-btn"
        aria-label={t('tb.min')}
        title={t('tb.min')}
        onClick={() => {
          act((a) => a.minimize());
        }}
      >
        <Icon name="minimize" size={16} />
      </button>
      <button
        className="cap-btn"
        aria-label={t('tb.max')}
        title={t('tb.max')}
        onClick={() => {
          act((a) => a.toggleMaximize());
        }}
      >
        <Icon name={maximized ? 'restore' : 'maximize'} size={16} />
      </button>
      <button
        className="cap-btn cap-close"
        aria-label={t('tb.close')}
        title={t('tb.close')}
        onClick={() => {
          act((a) => a.close());
        }}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
