// App.tsx — каркас приложения строго по прототипу v1.2 (design/prototype.html):
// титлбар по ОС, сайдбар со знаком «Отражение», шапка с вкладками, фоновое
// поле с анимацией, статус-бар. Разметка/классы — из утверждённого прототипа;
// стили — src/prototype.css (перенесён дословно).
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { DiagScreen } from './screens/screen_diag';
import { RulesScreen } from './screens/screen_rules';
import { ServersScreen } from './screens/screen_servers';
import { SubscriptionsScreen } from './screens/screen_subscriptions';
import { SettingsScreen } from './screens/screen_settings';

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
  const [prefs] = useState(() => loadPreferences(window.localStorage));
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
    applyTheme({ theme: prefs.theme, accent: prefs.accent, doc: document, win: window, storage: window.localStorage });
    return watchSystemTheme(window, () => {
      applyTheme({ theme: prefs.theme, accent: prefs.accent, doc: document, win: window, storage: window.localStorage });
    });
  }, [prefs]);

  useEffect(() => {
    if (!localStorage.getItem('lavray.lang')) {
      setLanguage(detectLanguage([...navigator.languages]));
    }
  }, []);

  const selectSection = useCallback((id: string): void => {
    setSectionId(id);
    setTabId('');
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

  const connOn = status.state === CoreState.CONNECTED;

  return (
    <div id="app" data-mode="native" tabIndex={-1}>
      <a className="skip-link" href="#main">
        {t('a11y.skip')}
      </a>
      <header id="titlebar">
        <div className="tb-left">
          {adapter.os === 'macos' && (
            <span className="tb-traffic" aria-hidden="true">
              <i className="t-red" />
              <i className="t-yel" />
              <i className="t-grn" />
            </span>
          )}
          <span className="tb-brand">LAVRay</span>
        </div>
        <span className="tb-flex" />
        <div className="tb-right">
          <button className="tb-ic" aria-label={t('aria.menu')}>
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
            {sectionId === 'rules' && <RulesScreen />}
            {sectionId === 'diag' && <DiagScreen />}
            {sectionId === 'settings' && <SettingsScreen />}
          </div>
        </main>
      </div>

      <footer id="statusbar">
        <span className="mono">
          {lang} · {adapter.id}
        </span>
        <span className="flex1" />
      </footer>
    </div>
  );
}
