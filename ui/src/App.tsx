/**
 * LAVRay application shell (stage-3 scaffold):
 * sidebar (5 sections) + header + per-tab stub screens + toast.
 * Keyboard: Ctrl/⌘+1…5 switch sections (DS §10); Esc dismisses the toast.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Header } from './components/Header';
import { ScreenStub } from './components/ScreenStub';
import { Sidebar } from './components/Sidebar';
import { Toast, type ToastState } from './components/Toast';
import { SECTIONS, type Section, type SectionTab } from './app/sections';
import { useI18n } from './hooks/useI18n';
import { applyDocumentLanguage, detectLanguage, setLanguage } from './lib/i18n';
import {
  applyTheme,
  loadPreferences,
  watchSystemTheme,
  type AccentPreference,
  type ThemePreference,
} from './lib/theme';
import { getPlatformAdapter } from './platform/adapter';

/** SECTIONS is a non-empty constant; fail loudly if that invariant breaks. */
function requireSection(id: string): Section {
  const section = SECTIONS.find((s) => s.id === id);
  if (section === undefined) throw new Error(`LAVRay: unknown section "${id}"`);
  return section;
}

function requireTab(section: Section, tabId: string): SectionTab {
  const tab = section.tabs.find((x) => x.id === tabId) ?? section.tabs[0];
  if (tab === undefined) throw new Error(`LAVRay: section "${section.id}" has no tabs`);
  return tab;
}

export default function App(): JSX.Element {
  const { t, tf, lang } = useI18n();

  // Initial language from the environment (DS §9: OS language by default).
  useEffect(() => {
    const initial = detectLanguage(navigator.languages);
    setLanguage(initial);
    applyDocumentLanguage(document);
  }, []);

  // Theme + accent state, persisted (prototype LS behavior).
  const [{ theme, accent }, setPrefs] = useState<Readonly<{ theme: ThemePreference; accent: AccentPreference }>>(() =>
    loadPreferences(window.localStorage),
  );

  useEffect(() => {
    applyTheme({ doc: document, win: window, storage: window.localStorage, theme, accent });
  }, [theme, accent]);

  // "system" theme follows the OS live (prototype mql listener).
  useEffect(() => {
    if (theme !== 'system') return undefined;
    return watchSystemTheme(window, () => {
      applyTheme({ doc: document, win: window, storage: window.localStorage, theme, accent });
    });
  }, [theme, accent]);

  // Active section + tab.
  const [sectionId, setSectionId] = useState<string>(SECTIONS[0]?.id ?? 'connection');
  const [tabId, setTabId] = useState<string>(requireTab(requireSection(SECTIONS[0]?.id ?? 'connection'), '').id);
  const section = useMemo(() => requireSection(sectionId), [sectionId]);
  const tab = useMemo(() => requireTab(section, tabId), [section, tabId]);

  const selectSection = useCallback((id: string): void => {
    setSectionId(id);
    setTabId(requireTab(requireSection(id), '').id);
  }, []);

  // Toast.
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastSeq = useRef(0);
  const showToast = useCallback((message: string): void => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, message });
  }, []);
  const closeToast = useCallback((): void => {
    setToast(null);
  }, []);

  // Demo of tf placeholders via the connect/disconnect actions.
  const onConnectDemo = useCallback((): void => {
    showToast(tf('toast.connected', { name: 'example.lavray.net' }));
  }, [showToast, tf]);

  // Platform adapter (web stub for now).
  const adapter = useMemo(() => getPlatformAdapter(window), []);

  // Keyboard: Ctrl/⌘+1…5 — sections; Esc — close toast.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = adapter.os === 'macos' ? e.metaKey : e.ctrlKey;
      if (mod && !e.altKey && !e.shiftKey && e.key >= '1' && e.key <= '5') {
        const target = SECTIONS[Number(e.key) - 1];
        if (target !== undefined) {
          e.preventDefault();
          selectSection(target.id);
        }
        return;
      }
      if (e.key === 'Escape' && toast !== null) closeToast();
    };
    window.addEventListener('keydown', onKey);
    return (): void => {
      window.removeEventListener('keydown', onKey);
    };
  }, [adapter.os, selectSection, toast, closeToast]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        {t('a11y.skip')}
      </a>
      <Sidebar active={sectionId} onSelect={selectSection} />
      <div className="main">
        <Header
          theme={theme}
          accent={accent}
          onTheme={(next) => {
            setPrefs((p) => ({ ...p, theme: next }));
          }}
          onAccent={(next) => {
            setPrefs((p) => ({ ...p, accent: next }));
          }}
        />
        <main id="main" className="content" aria-label={t(section.navKey)}>
          <ScreenStub
            key={`${section.id}/${tab.id}`}
            section={section}
            tab={tab}
            onTab={setTabId}
            onConnectDemo={onConnectDemo}
          />
        </main>
      </div>
      <Toast toast={toast} onClose={closeToast} />
      <footer className="statusbar cap">
        <span className="mono">
          {lang} · {adapter.id}
        </span>
        <span className="flex1" />
      </footer>
    </div>
  );
}
