// SPDX-License-Identifier: GPL-3.0-only

// App.tsx — каркас приложения строго по прототипу v1.2 (design/prototype.html):
// титлбар по ОС, сайдбар со знаком «Отражение», шапка с вкладками, фоновое
// поле с анимацией, статус-бар. Разметка/классы — из утверждённого прототипа;
// стили — src/prototype.css (перенесён дословно).
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { BrandMark, Icon, type IconName } from './components/Icon';
import { SECTIONS, type Section, type SectionTab } from './app/sections';
import { CoreContext, useCore, useCoreClients, useCoreStatus } from './hooks/useCore';
import { ConnectMode, CoreState } from './gen/lavray_pb';
import { useI18n, useStartupLanguage } from './hooks/useI18n';
import { useAgentAccessSync } from './hooks/useAgentAccess';
import { useSystemProxyApplied } from './hooks/useSystemProxy';
import { useSystemProxyFollow } from './hooks/useSystemProxyFollow';
import { useTrafficStats } from './hooks/useTraffic';
import { useShellBridge } from './hooks/useShellBridge';
import { applyDocumentLanguage, formatSpeed } from './lib/i18n';
import { applyTheme, loadPreferences, paintTheme, watchSystemTheme } from './lib/theme';
import { focusWhenReady, hotkeyOf, isTypingTarget } from './lib/hotkeys';
import { loadModes, toggleConnection } from './lib/connection';
import type { TrayAction } from './lib/tray';
import { onTablistKeyDown } from './lib/tabs';
import { getPlatformAdapter } from './platform/adapter';
import { ConnectionScreen } from './screens/screen_connection';
import { ConnsScreen } from './screens/conns/ConnsScreen';
import { DiagScreen } from './screens/screen_diag';
import { DnsScreen } from './screens/screen_dns';
import { LogScreen } from './screens/screen_log';
import { RulesScreen } from './screens/rules/RulesScreen';
import { ServersScreen } from './screens/screen_servers';
import { SubscriptionsScreen } from './screens/screen_subscriptions';
import { SettingsScreen } from './screens/screen_settings';
import { UpdatesScreen } from './screens/screen_updates';
import { ImportDialog } from './components/ImportDialog';
import { HotkeysDialog, LicensesDialog, OnboardingDialog } from './components/dialogs';
import { TitlebarMenu } from './components/TitlebarMenu';
import { WindowChrome } from './components/WindowChrome';

const NAV_ICONS: Record<string, IconName> = {
  connection: 'zap',
  servers: 'layers',
  rules: 'route',
  diag: 'activity',
  settings: 'settings',
};

export default function App(): JSX.Element {
  // T-37: сохранённый язык применяется до первого рендера дерева.
  useStartupLanguage();
  const clients = useCoreClients();
  return (
    <CoreContext.Provider value={clients}>
      <AppInner />
    </CoreContext.Provider>
  );
}

function AppInner(): JSX.Element {
  const { t, lang } = useI18n();
  // ?theme=light&lang=de — предпросмотр темы/языка для скриншот-проверок
  // (иначе localStorage не задать в headless-браузере).
  const [prefs] = useState(() => {
    const base = loadPreferences(window.localStorage);
    const params = new URLSearchParams(window.location.search);
    const theme = params.get('theme');
    const accent = params.get('accent');
    return {
      theme:
        theme === 'light' || theme === 'dark' || theme === 'system' ? theme : base.theme,
      accent:
        accent === 'auto' || accent === 'amber' || accent === 'sage' || accent === 'graphite'
          ? accent
          : base.accent,
    };
  });
  // Хеш-API (как в прототипе): #screen=servers&tab=subscriptions — для
  // скриншотов/проверок; неизвестное значение игнорируется.
  const initial = ((): { section: string; tab: string } => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const sec = params.get('screen') ?? '';
    const known = SECTIONS.find((x) => x.id === sec);
    return { section: known ? sec : 'connection', tab: params.get('tab') ?? '' };
  })();
  const [sectionId, setSectionId] = useState(initial.section);
  const [tabId, setTabId] = useState(initial.tab);
  // Онбординг — при первом запуске (как в прототипе: dlgOnb).
  const [onboarding, setOnboarding] = useState(() => {
    // ?onboarded=1 — для скриншот-тестов и повторных проверок UI.
    const params = new URLSearchParams(window.location.search);
    if (params.get('onboarded') === '1') return false;
    return window.localStorage.getItem('lavray.onboarded') !== '1';
  });
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [quickImport, setQuickImport] = useState<'link' | 'qr' | 'file' | null>(null);
  // Узкий сайдбар-рельс (600…959 px): подписи разделов скрыты, видны только иконки.
  const [rail, setRail] = useState(() => window.innerWidth >= 600 && window.innerWidth < 960);
  // Меню титлбара (прототип tbMenuItems): импорт, подключение, справка, выход.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const adapter = useMemo(() => getPlatformAdapter(window), []);
  const status = useCoreStatus();
  const core = useCore();
  const connOn = status.state === CoreState.CONNECTED;
  // MCP: окно ставит/снимает системный прокси, когда ядро подключил другой клиент,
  // и сообщает оболочке режим доступа агентов.
  useSystemProxyFollow(status);
  useAgentAccessSync();

  const section: Section | undefined = useMemo(
    () => SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0],
    [sectionId],
  );
  const tab: SectionTab | undefined = useMemo(
    () => section?.tabs.find((x) => x.id === tabId) ?? section?.tabs[0],
    [section, tabId],
  );

  useEffect(() => {
    applyDocumentLanguage(document, lang);
  }, [lang]);

  useEffect(() => {
    const onLic = (): void => { setLicensesOpen(true); };
    window.addEventListener('lavray:licenses', onLic);
    return (): void => {
      window.removeEventListener('lavray:licenses', onLic);
    };
  }, []);

  // Адаптив по прототипу (S6): ширина < 960 — узкий сайдбар (w-md),
  // < 600 — нижняя навигация (w-sm). Без этого на узких окнах контент
  // обрезался справа: колонка сайдбара не отдавала место.
  useEffect(() => {
    // Ширину берём у viewport (в прототипе — contentRect #app; при
    // data-mode=native у #app может быть min-width, из-за чего классификация
    // «узко/широко» съезжала). Порог 600 → нижняя навигация, 960 → рельс.
    const apply = (w: number): void => {
      document.body.classList.toggle('w-md', w >= 600 && w < 960);
      document.body.classList.toggle('w-sm', w < 600);
      setRail(w >= 600 && w < 960);
    };
    apply(window.innerWidth);
    const onResize = (): void => {
      apply(window.innerWidth);
    };
    window.addEventListener('resize', onResize);
    return (): void => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    // Первичная установка темы (с учётом ?theme=/?accent= для предпросмотра);
    // здесь же выбор сохраняется, как и раньше.
    applyTheme({ theme: prefs.theme, accent: prefs.accent, doc: document, win: window, storage: window.localStorage });
    // T-37: смена темы ОС перекрашивает документ ТОЛЬКО при выборе «Как в
    // системе» и ничего не записывает. Актуальный выбор читаем из хранилища:
    // его пишет экран «Настройки», а `prefs` — начальные настройки, они
    // устарели после первого же переключения темы.
    return watchSystemTheme(window, () => {
      const current = loadPreferences(window.localStorage);
      if (current.theme !== 'system') return;
      paintTheme({ theme: current.theme, accent: current.accent, doc: document, win: window });
    });
  }, [prefs]);

  const selectSection = useCallback((id: string): void => {
    setSectionId(id);
    setTabId('');
    // Смена раздела — с начала страницы, иначе шапка остаётся за краем.
    // typeof-проверка: в jsdom у элемента нет scrollTo (?. не спасает).
    const mainEl = document.getElementById('main');
    if (mainEl !== null && typeof mainEl.scrollTo === 'function') {
      mainEl.scrollTo({ top: 0 });
    }
    // Держим hash в синхроне: на него опираются переходы из других экранов
    // (диагностика → маршрут, импорт → серверы) и скриншот-проверки.
    window.location.hash = `screen=${id}`;
  }, []);

  // AP-02 (аудит round 3): смена hash извне переключает экран.
  useEffect(() => {
    const onHash = (): void => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const sec = params.get('screen') ?? '';
      if (SECTIONS.some((x) => x.id === sec)) {
        setSectionId(sec);
        setTabId(params.get('tab') ?? '');
        const el = document.getElementById('main');
        if (el !== null && typeof el.scrollTo === 'function') el.scrollTo({ top: 0 });
      }
    };
    window.addEventListener('hashchange', onHash);
    return (): void => {
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = adapter.os === 'macos' ? e.metaKey : e.ctrlKey;
      const key = hotkeyOf(e); // по физической клавише: работает и на русской раскладке
      if (mod && !e.altKey && !e.shiftKey && key >= '1' && key <= '5') {
        const target = SECTIONS[Number(key) - 1];
        if (target !== undefined) {
          e.preventDefault();
          selectSection(target.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => {
      window.removeEventListener('keydown', onKey);
    };
  }, [adapter.os, selectSection]);

  // Хоткеи прототипа (FR-UI-231…235): Ctrl/⌘+K — поиск, +D — подключить,
  // «,» — настройки, «?» — список хоткеев. Игнорируем ввод в полях.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = isTypingTarget(e.target);
      const mod = adapter.os === 'macos' ? e.metaKey : e.ctrlKey;
      const key = hotkeyOf(e);
      if (mod && key === 'd' && !typing) {
        e.preventDefault();
        // Прототип: Ctrl+D переключает соединение, а не только открывает
        // экран. При пустом списке профилей остаётся навигация.
        void (async (): Promise<void> => {
          try {
            const done = await toggleConnection({
              core,
              connected: connOn,
              port: status.inbound?.port ?? 2080,
            });
            if (!done) selectSection('connection');
          } catch {
            selectSection('connection');
          }
        })();
        return;
      }
      if (mod && key === ',' && !typing) {
        e.preventDefault();
        selectSection('settings');
        return;
      }
      if (e.key === '?' && !typing) {
        e.preventDefault();
        setHotkeysOpen(true);
      }
      // Ctrl/⌘+K: список серверов и фокус в поле поиска (прототип: profSearch.focus()).
      // Работает и из других полей ввода: сочетание с модификатором текста не печатает.
      if (mod && !e.altKey && !e.shiftKey && key === 'k') {
        e.preventDefault();
        selectSection('servers');
        focusWhenReady('#profSearch', true);
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => {
      window.removeEventListener('keydown', onKey);
    };
  }, [adapter.os, selectSection, core, connOn, status.inbound]);

  // Стабильные колбэки для меню: AppInner перерисовывается раз в секунду
  // (опрос статуса), и инлайновые стрелки перезапускали эффект меню —
  // фокус прыгал на первый пункт.
  const handleToggleConnect = useCallback((): void => {
    void (async (): Promise<void> => {
      try {
        const done = await toggleConnection({
          core,
          connected: connOn,
          port: status.inbound?.port ?? 2080,
        });
        if (!done) selectSection('connection');
      } catch {
        selectSection('connection');
      }
    })();
  }, [core, connOn, status.inbound, selectSection]);

  // Трей: состояние и тексты уходят в оболочку, а «Подключить»/«Отключить» из
  // меню трея выполняет UI — профиль и режимы знает он.
  const handleTrayAction = useCallback(
    (action: TrayAction): void => {
      if ((action === 'connect') === connOn) return; // меню могло устареть
      handleToggleConnect();
    },
    [connOn, handleToggleConnect],
  );
  useShellBridge(status, handleTrayAction, handleToggleConnect);

  const handleAbout = useCallback((): void => {
    selectSection('settings');
    // Настройки грузятся асинхронно: ждём появления секции, а не фиксированные
    // 80 мс, иначе при медленном ядре скролл молча не срабатывает.
    let tries = 0;
    const tick = (): void => {
      const el = document.querySelector('[data-sec="about"]');
      if (el !== null) {
        el.scrollIntoView({ block: 'start' });
        const h = el.querySelector('h2');
        if (h !== null) {
          h.tabIndex = -1;
          h.focus();
        }
        return;
      }
      if (tries++ < 40) window.setTimeout(tick, 50);
    };
    window.setTimeout(tick, 50);
  }, [selectSection]);

  const handleMenuClose = useCallback((): void => {
    setMenuAt(null);
  }, []);

  // Статус-бар: скорости и текущий профиль. Скорости — из того же потока
  // статистики, что и график; профиль берём из статуса ядра (его имя
  // приходит в CoreStatus), не загружая весь список.
  const { speed, error: trafficError } = useTrafficStats(connOn);
  const [modes, setModes] = useState(() => loadModes(window.localStorage));
  useEffect(() => {
    // Экран подключения меняет режимы — статус-бар подхватывает изменения.
    const sync = (): void => { setModes(loadModes(window.localStorage)); };
    window.addEventListener('storage', sync);
    const id = window.setInterval(sync, 1500);
    return (): void => {
      window.removeEventListener('storage', sync);
      window.clearInterval(id);
    };
  }, []);
  const activeProfileName =
    status.activeProfileName === undefined || status.activeProfileName === ''
      ? '—'
      : status.activeProfileName;
  // Чипы показывают фактическое состояние, а не переключатели: TUN горит, лишь
  // когда ядро работает в режиме TUN, системный прокси — когда оболочка его
  // применила. Чип виден и по настройке (потускневший), и по факту.
  const sysApplied = useSystemProxyApplied();
  const tunOn = connOn && status.mode === ConnectMode.TUN;
  const sysOn = connOn && sysApplied;

  return (
    <div
      id="app"
      data-mode={
        (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined
          ? 'native'
          : 'browser'
      }
      tabIndex={-1}
    >
      <a className="skip-link" href="#main">
        {t('a11y.skip')}
      </a>
      {/* data-tauri-drag-region: перетаскивание и двойной клик (разворот)
          обрабатывает сама Tauri. Ручной window_start_drag на mousedown
          съедал второй клик — двойной клик не разворачивал окно. Кнопки
          внутри шапки помечены no-drag в CSS. */}
      <header id="titlebar" data-tauri-drag-region>
        <div className="tb-left">
          {/* macOS: «светофор» первым элементом шапки (прототип, #titlebar). */}
          <WindowChrome os={adapter.os} placement="start" />
          <span className="tb-brand">
            <BrandMark size={16} />
            <span>LAVRay</span>
          </span>
          <button
            className="tb-ic"
            id="tbMenu"
            aria-label={t('aria.menu')}
            title={t('aria.menu')}
            aria-haspopup="menu"
            aria-expanded={menuAt !== null}
            onClick={(e) => {
              // Повторный клик закрывает: без toggle mousedown на документе
              // закрывал меню, а click тут же открывал его снова.
              if (menuAt !== null) {
                setMenuAt(null);
                return;
              }
              const r = e.currentTarget.getBoundingClientRect();
              setMenuAt({ x: r.left, y: r.bottom + 4 });
            }}
          >
            <Icon name="menu" />
          </button>
        </div>
        <span className="tb-flex" />
        <WindowChrome os={adapter.os} placement="end" />
      </header>

      <div id="body">
        <div id="bgField" aria-hidden="true" data-conn={connOn ? 'on' : 'off'}>
          <i className="bf-beam b1" />
          <i className="bf-beam b2" />
          <i className="bf-floor" />
          <i className="bf-streak" />
          <i className="bf-grain" />
        </div>

        <aside id="sidebar">
          <button
            className="sb-logo"
            tabIndex={-1}
            onClick={() => {
              selectSection('connection');
            }}
          >
            <BrandMark size={24} />
            <span className="lg-name">LAVRay</span>
          </button>
          <nav className="sb-nav" aria-label={t('aria.nav')}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`sb-item${s.id === sectionId ? ' on' : ''}`}
                // Подсказка нужна только когда подпись скрыта (прототип: tip у .sb-item в w-md).
                title={rail ? t(s.navKey) : undefined}
                onClick={() => {
                  selectSection(s.id);
                }}
                aria-current={s.id === sectionId ? 'page' : undefined}
              >
                <Icon name={NAV_ICONS[s.id] ?? 'settings'} />
                <span className="sb-l">{t(s.navKey)}</span>
              </button>
            ))}
          </nav>
          <div className="sb-bottom">
            <div className="sb-card">
              <span className={`dot${connOn ? ' ok' : ''}`} />
              <span className="sb-card-t">
                <span className="cap">{t('core.title')}</span>
                <span className="sb-card-v">
                  {connOn ? t('conn.state.on') : t('conn.state.off')}
                </span>
              </span>
            </div>
          </div>
        </aside>

        <main id="main" tabIndex={-1}>
          {section !== undefined && (
            <div id="grpHead">
              <h1 id="ghTitle">{t(section.navKey)}</h1>
              <p className="sub" id="ghSub">{tab ? t(tab.subKey) : ''}</p>
              {section.tabs.length > 1 && (
                <div
                  className="subtabs"
                  id="ghTabs"
                  role="tablist"
                  aria-label={t('aria.tabs')}
                  onKeyDown={(e) => {
                    // T-38: ←/→/Home/End переключают вкладку и переносят на неё фокус.
                    onTablistKeyDown(e, (i) => {
                      const next = section.tabs[i];
                      if (next !== undefined) setTabId(next.id);
                    });
                  }}
                >
                  {section.tabs.map((tb) => (
                    <button
                      key={tb.id}
                      id={`tab-${tb.id}`}
                      className="subtab"
                      role="tab"
                      aria-selected={tb.id === (tab?.id ?? '')}
                      aria-controls="screen-conn"
                      tabIndex={tb.id === (tab?.id ?? '') ? 0 : -1}
                      onClick={() => {
                        setTabId(tb.id);
                      }}
                    >
                      {'literal' in tb.label ? tb.label.literal : t(tb.label.key)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Одна панель на все вкладки раздела (прототип: #scr-*, role=tabpanel
              только у разделов с несколькими вкладками). */}
          <div
            className="screen active"
            id="screen-conn"
            role={section !== undefined && section.tabs.length > 1 ? 'tabpanel' : undefined}
            aria-labelledby={
              section !== undefined && section.tabs.length > 1 && tab !== undefined
                ? `tab-${tab.id}`
                : undefined
            }
          >
            {/* T-73: после мастера экран перечитывает режимы из localStorage (key). */}
            {sectionId === 'connection' && <ConnectionScreen key={onboarding ? 'onboarding' : 'ready'} />}
            {sectionId === 'servers' &&
              (tab?.id === 'subscriptions' ? <SubscriptionsScreen /> : <ServersScreen />)}
            {sectionId === 'rules' && (tab?.id === 'dns' ? <DnsScreen /> : <RulesScreen />)}
            {sectionId === 'diag' && tab?.id === 'conns' && <ConnsScreen active={connOn} />}
            {sectionId === 'diag' && tab?.id === 'log' && <LogScreen />}
            {sectionId === 'diag' && tab?.id !== 'conns' && tab?.id !== 'log' && <DiagScreen />}
            {sectionId === 'settings' &&
              (tab?.id === 'updates' ? <UpdatesScreen /> : <SettingsScreen />)}
          </div>
        </main>
      </div>

      {onboarding && (
        <OnboardingDialog
          onClose={() => {
            setOnboarding(false);
            window.localStorage.setItem('lavray.onboarded', '1');
            setModes(loadModes(window.localStorage)); // чипы статус-бара без ожидания опроса
          }}
          onOpenImport={(tab) => { setQuickImport(tab ?? 'link'); }}
        />
      )}
      {hotkeysOpen && <HotkeysDialog onClose={() => { setHotkeysOpen(false); }} />}
      {licensesOpen && <LicensesDialog onClose={() => { setLicensesOpen(false); }} />}
      {menuAt !== null && (
        <TitlebarMenu
          at={menuAt}
          connected={connOn}
          os={adapter.os}
          onImport={() => { setQuickImport('file'); }}
          onToggleConnect={handleToggleConnect}
          onOnboarding={() => { setOnboarding(true); }}
          onHotkeys={() => { setHotkeysOpen(true); }}
          onAbout={handleAbout}
          onQuit={() => {
            void (async (): Promise<void> => {
              if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === undefined) {
                return;
              }
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('quit_app');
            })();
          }}
          onClose={handleMenuClose}
        />
      )}
      {/* Настройки → «Лицензии и компоненты» открывают диалог событием. */}
      {quickImport !== null && (
        <ImportDialog
          initialTab={quickImport}
          onClose={() => { setQuickImport(null); }}
          onImported={() => {
            window.location.hash = 'screen=servers&tab=profiles';
          }}
        />
      )}

      <footer id="statusbar">
        {/* Статус-бар прототипа: состояние, профиль, скорости, чипы
            TUN/системный прокси. Раньше здесь были внутренние id
            («ru · tauri») — отладочная информация в готовом UI. */}
        <span className="st-item">
          <span className={`dot${connOn ? ' ok' : ''}`} />
          <span className="st-state">
            {connOn ? t('conn.state.on') : t('conn.state.off')}
          </span>
        </span>
        <span className="st-sep" />
        <span className="st-item">
          <span className="st-k">{t('st.profile')}</span>
          <span className="mono">{activeProfileName}</span>
        </span>
        <span className="st-sep" />
        <span className="st-item" style={{ gap: 10 }} title={trafficError === '' ? undefined : trafficError}>
          <span className="spd dn">
            <Icon name="download" size={16} />
            <span>{formatSpeed(speed.down, lang)}</span>
          </span>
          <span className="spd up">
            <Icon name="upload" size={16} />
            <span>{formatSpeed(speed.up, lang)}</span>
          </span>
        </span>
        <span className="flex1" />
        {(modes.tunMode || tunOn) && (
          <span className={`st-chip${tunOn ? ' on' : ''}`} title={t('set.tunD')}>
            <span className="dot" />
            TUN
          </span>
        )}
        {(modes.sysProxy || sysOn) && (
          <span className={`st-chip${sysOn ? ' on' : ''}`} title={t('set.sysproxyD')}>
            <span className="dot" />
            <span>{t('st.sysproxy')}</span>
          </span>
        )}
      </footer>
    </div>
  );
}
