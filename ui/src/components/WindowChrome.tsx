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
  toggleMaximize: () => Promise<boolean>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onResized: (cb: () => void) => Promise<() => void>;
}

/**
 * Управление окном идёт через команды оболочки (`window_*` в shell/src/
 * main.rs), а не через `@tauri-apps/api/window`: у безрамочного окна
 * JS-команды требуют ACL-разрешений на каждое действие, и любое
 * отсутствующее право молча оставляло кнопку мёртвой.
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
    toggleMaximize: () => invokeShell<boolean>('window_toggle_maximize'),
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
  /**
   * Где в шапке стоит блок: `start` — слева (macOS-«светофор» по
   * прототипу), `end` — справа (Windows/Linux). Прототип ставит светофор
   * первым элементом #titlebar, а кнопки Windows — последними, поэтому
   * один компонент рендерит разное в зависимости от слота.
   */
  readonly placement: 'start' | 'end';
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
export function WindowChrome({ os, placement }: WindowChromeProps): JSX.Element | null {
  const platform = normOs(os);
  if (platform === 'other') return null;

  // Слот решает, что рендерить: macOS-«светофор» — только в начале шапки,
  // кнопки Windows/Linux — только в конце. Иначе светофор оказывался
  // справа, как в первой версии.
  if (platform === 'mac' ? placement !== 'start' : placement !== 'end') return null;

  // Состояние окна и подписка на его события живут во вложенном компоненте,
  // то есть только у того экземпляра, который рисует кнопки. Раньше хуки стояли
  // выше ранних return, и оба экземпляра (start и end) подписывались на
  // onResized: по два IPC window_is_maximized на каждое изменение размера (T-62).
  return <ChromeButtons platform={platform} />;
}

function ChromeButtons({ platform }: { readonly platform: 'win' | 'mac' | 'linux' }): JSX.Element {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    // ref вместо локального `let`: линтер не сужает тип в асинхронном
    // замыкании и не считает проверку мёртвой веткой.
    const alive = { current: true };
    // Функция, а не чтение поля: после await TS считал бы alive.current всегда true.
    const isAlive = (): boolean => alive.current;
    let unlisten: (() => void) | undefined;
    void (async (): Promise<void> => {
      try {
        const api = await loadWinApi();
        if (api === null || !alive.current) return;
        setMaximized(await api.isMaximized());
        const stop = await api.onResized(() => {
          void api
            .isMaximized()
            .then((m) => {
              if (alive.current) setMaximized(m);
            })
            .catch(() => {
              /* окно закрывается — состояние уже не важно */
            });
        });
        // Компонент мог размонтироваться, пока подписка оформлялась: cleanup
        // уже отработал, отписаться нужно здесь, иначе слушатель утечёт.
        if (isAlive()) unlisten = stop;
        else stop();
      } catch {
        /* не Tauri или окно уже уничтожено: кнопки останутся без состояния */
      }
    })();
    return (): void => {
      alive.current = false;
      unlisten?.();
    };
  }, []);

  // Действие кнопки: ошибки invoke не должны всплывать как unhandled
  // rejection (окно уже перетаскивается, ACL, окно закрыто).
  const act = (fn: (api: WinApi) => Promise<void>): void => {
    void (async (): Promise<void> => {
      try {
        const api = await loadWinApi();
        if (api !== null) await fn(api);
      } catch {
        /* окно недоступно — молча игнорируем */
      }
    })();
  };

  // Развернуть/восстановить: состояние берём из ответа команды, а не только
  // из события Resized (на части WM оно приходит с задержкой).
  const toggleMax = (): void => {
    void (async (): Promise<void> => {
      try {
        const api = await loadWinApi();
        if (api !== null) setMaximized(await api.toggleMaximize());
      } catch {
        /* см. act */
      }
    })();
  };

  // macOS: системный «светофор» рисуется самой ОС только у декорированного
  // окна; у безрамочного его нет — рисуем свои кнопки тем же видом.
  if (platform === 'mac') {
    return (
      <span className="tl-mac" aria-hidden="false">
        <button
          className="tl r"
          tabIndex={-1}
          aria-label={t('tb.close')}
          title={t('tb.close')}
          onClick={() => {
            act((a) => a.close());
          }}
        />
        <button
          className="tl y"
          tabIndex={-1}
          aria-label={t('tb.min')}
          title={t('tb.min')}
          onClick={() => {
            act((a) => a.minimize());
          }}
        />
        <button
          className="tl g"
          tabIndex={-1}
          aria-label={t(maximized ? 'tb.restore' : 'tb.max')}
          title={t(maximized ? 'tb.restore' : 'tb.max')}
          onClick={toggleMax}
        />
      </span>
    );
  }
  if (platform === 'linux') {
    return (
      <div className="caps-linux">
        <button
          className="cap-btn cap-round"
          tabIndex={-1}
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
        tabIndex={-1}
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
        tabIndex={-1}
        aria-label={t(maximized ? 'tb.restore' : 'tb.max')}
        title={t(maximized ? 'tb.restore' : 'tb.max')}
        onClick={toggleMax}
      >
        <Icon name={maximized ? 'restore' : 'maximize'} size={16} />
      </button>
      <button
        className="cap-btn cap-close"
        tabIndex={-1}
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
