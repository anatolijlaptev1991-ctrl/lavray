// screen_settings.tsx — «Настройки» (DS §8): язык, тема, акцент, режим,
// сведения о ядре. Тема/акцент — локальные предпочтения (data-атрибуты),
// язык — i18n; остальное — SettingsService.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';
import {
  applyTheme,
  loadPreferences,
  type AccentPreference,
  type ThemePreference,
} from '../lib/theme';

const THEMES: { id: ThemePreference; key: string }[] = [
  { id: 'dark', key: 'theme.dark' },
  { id: 'light', key: 'theme.light' },
  { id: 'system', key: 'theme.system' },
];

const ACCENTS: { id: AccentPreference; key: string }[] = [
  { id: 'auto', key: 'accent.auto' },
  { id: 'amber', key: 'accent.amber' },
  { id: 'sage', key: 'accent.sage' },
  { id: 'graphite', key: 'accent.graphite' },
];

export function SettingsScreen(): JSX.Element {
  const { t, lang, setLanguage } = useI18n();
  const core = useCore();
  const [prefs, setPrefs] = useState(() => loadPreferences(window.localStorage));
  const [coreVersion, setCoreVersion] = useState('');
  const [rootVersion, setRootVersion] = useState(0);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const st = await core.core.getStatus({});
        setCoreVersion(st.coreVersion);
        const up = await core.updates.getUpdateState({});
        setRootVersion(up.chainState?.rootVersion ?? 0);
      } catch {
        /* ядро не запущено — версии останутся пустыми */
      }
    })();
  }, [core]);

  const change = (next: Partial<typeof prefs>): void => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    // applyTheme сам персистит выбор в storage (см. lib/theme.ts).
    applyTheme({
      theme: merged.theme,
      accent: merged.accent,
      doc: document,
      win: window,
      storage: window.localStorage,
    });
  };

  return (
    <div className="set">
      <section className="set-block">
        <h3>{t('set.theme')}</h3>
        <div className="seg" role="radiogroup" aria-label={t('set.theme')}>
          {THEMES.map((th) => (
            <button
              key={th.id}
              role="radio"
              aria-checked={prefs.theme === th.id}
              onClick={() => {
                change({ theme: th.id });
              }}
            >
              {t(th.key as never)}
            </button>
          ))}
        </div>
      </section>

      <section className="set-block">
        <h3>{t('set.accent')}</h3>
        <div className="seg" role="radiogroup" aria-label={t('set.accent')}>
          {ACCENTS.map((ac) => (
            <button
              key={ac.id}
              role="radio"
              aria-checked={prefs.accent === ac.id}
              onClick={() => {
                change({ accent: ac.id });
              }}
            >
              {t(ac.key as never)}
            </button>
          ))}
        </div>
      </section>

      <section className="set-block">
        <h3>{t('set.lang')}</h3>
        <div className="seg" role="radiogroup" aria-label={t('set.lang')}>
          {(['ru', 'en', 'zh', 'es', 'de'] as const).map((l) => (
            <button
              key={l}
              role="radio"
              aria-checked={lang === l}
              onClick={() => {
                setLanguage(l);
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      <section className="set-block">
        <h3>{t('lic.title')}</h3>
        <div className="muted mono">
          LAVRay · {t('lic.core')} {coreVersion === '' ? '—' : coreVersion} · root v
          {String(rootVersion)}
        </div>
      </section>
    </div>
  );
}
