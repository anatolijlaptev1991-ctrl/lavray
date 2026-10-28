// App.tsx — каркас приложения строго по прототипу v1.2 (design/prototype.html):
// титлбар по ОС, сайдбар со знаком «Отражение», шапка с вкладками, фоновое
// поле с анимацией, статус-бар. Разметка/классы — из утверждённого прототипа;
// стили — src/prototype.css (перенесён дословно).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { BrandMark, Icon, type IconName } from './components/Icon';
import { SECTIONS, type Section, type SectionTab } from './app/sections';
import { CoreContext, useCoreClients, useCoreStatus } from './hooks/useCore';
import { CoreState } from './gen/lavray_pb';
import { useI18n } from './hooks/useI18n';
import { applyDocumentLanguage, detectLanguage, setLanguage } from './lib/i18n';
import { applyTheme, loadPreferences, watchSystemTheme } from './lib/theme';
import { getPlatformAdapter } from './platform/adapter';
import { ConnectionScreen } from './screens/screen_connection';
import { ConnsScreen } from './screens/screen_conns';
import { DiagScreen } from './screens/screen_diag';
import { DnsScreen } from './screens/screen_dns';
import { LogScreen } from './screens/screen_log';
import { RulesScreen } from './screens/screen_rules';
import { ServersScreen } from './screens/screen_servers';
import { SubscriptionsScreen } from './screens/screen_subscriptions';
import { SettingsScreen } from './screens/screen_settings';
import { UpdatesScreen } from './screens/screen_updates';
import { ImportDialog } from './components/ImportDialog';
import { HotkeysDialog, LicensesDialog, OnboardingDialog } from './components/dialogs';

const NAV_ICONS: Record<string, IconName> = {
  connection: 'zap',
  servers: 'layers',
  rules: 'route',
  diag: 'activity',
  settings: 'settings',
};

export default function App(): JSX.Element {
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
  const adapter = useMemo(() => getPlatformAdapter(window), []);
  const status = useCoreStatus();

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

  // D2 (аудит round 2): колбэк системной темы обязан читать АКТУАЛЬНЫЕ
  // настройки, иначе смена темы ОС откатывала выбор пользователя.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    const apply = (): void => {
      applyTheme({ theme: prefsRef.current.theme, accent: prefsRef.current.accent, doc: document, win: window, storage: window.localStorage });
    };
    apply();
    return watchSystemTheme(window, apply);
  }, []);

  useEffect(() => {
    // D3: выбор языка сохраняется; при первом запуске — из navigator.
    const forced = new URLSearchParams(window.location.search).get('lang');
    if (forced !== null && ['ru', 'zh', 'en', 'es', 'de'].includes(forced)) {
      setLanguage(forced as 'ru' | 'zh' | 'en' | 'es' | 'de');
      return;
    }
    const saved = localStorage.getItem('lavray.lang');
    if (saved === null) {
      const detected = detectLanguage([...navigator.languages]);
      setLanguage(detected);
      localStorage.setItem('lavray.lang', detected);
    }
  }, []);

  const selectSection = useCallback((id: string): void => {
    setSectionId(id);
    setTabId('');
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
      if (mod && !e.altKey && !e.shiftKey && e.key >= '1' && e.key <= '5') {
        const target = SECTIONS[Number(e.key) - 1];
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
      const el = e.target as HTMLElement | null;
      const typing =
        el !== null &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      const mod = adapter.os === 'macos' ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'd' && !typing) {
        e.preventDefault();
        selectSection('connection');
        return;
      }
      if (mod && e.key === ',' && !typing) {
        e.preventDefault();
        selectSection('settings');
        return;
      }
      if (e.key === '?' && !typing) {
        e.preventDefault();
        setHotkeysOpen(true);
      }
      if (mod && e.key.toLowerCase() === 'k' && !typing) {
        e.preventDefault();
        selectSection('servers');
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => {
      window.removeEventListener('keydown', onKey);
    };
  }, [adapter.os, selectSection]);

  const connOn = status.state === CoreState.CONNECTED;

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
      <header id="titlebar">
        <div className="tb-left">
          {/* «Светофор» macOS — классы прототипа (.tl-mac/.tl.r|y|g),
              иначе иконки имели нулевой размер и были невидимы. */}
          {adapter.os === 'macos' && (
            <span className="tl-mac" aria-hidden="true">
              <i className="tl r" />
              <i className="tl y" />
              <i className="tl g" />
            </span>
          )}
          <span className="tb-brand">LAVRay</span>
        </div>
        <span className="tb-flex" />
        <div className="tb-right">
          <button
            className="tb-ic"
            aria-label={t('aria.menu')}
            title={t('aria.menu')}
            onClick={() => {
              setHotkeysOpen(true);
            }}
          >
            <Icon name="menu" />
          </button>
        </div>
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
                <div className="subtabs" id="ghTabs" role="tablist" aria-label={t('aria.tabs')}>
                  {section.tabs.map((tb) => (
                    <button
                      key={tb.id}
                      className="subtab"
                      role="tab"
                      aria-selected={tb.id === (tab?.id ?? '')}
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
          <div className="screen active" id="screen-conn">
            {sectionId === 'connection' && <ConnectionScreen />}
            {sectionId === 'servers' &&
              (tab?.id === 'subscriptions' ? <SubscriptionsScreen /> : <ServersScreen />)}
            {sectionId === 'rules' && (tab?.id === 'dns' ? <DnsScreen /> : <RulesScreen />)}
            {sectionId === 'diag' && tab?.id === 'conns' && <ConnsScreen />}
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
          }}
          onOpenImport={(tab) => { setQuickImport(tab ?? 'link'); }}
        />
      )}
      {hotkeysOpen && <HotkeysDialog onClose={() => { setHotkeysOpen(false); }} />}
      {licensesOpen && <LicensesDialog onClose={() => { setLicensesOpen(false); }} />}
      {/* Настройки → «Лицензии и компоненты» открывают диалог событием. */}
      {quickImport !== null && (
        <ImportDialog
          groupId={0n}
          initialTab={quickImport}
          onClose={() => { setQuickImport(null); }}
          onImported={() => {
            window.location.hash = 'screen=servers&tab=profiles';
          }}
        />
      )}

      <footer id="statusbar">
        <span className="mono">
          {lang} · {adapter.id}
        </span>
        <span className="flex1" />
      </footer>
    </div>
  );
}
