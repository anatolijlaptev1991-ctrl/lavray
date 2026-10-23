/**
 * Header (stub): window-level bar with quick language / theme / accent
 * controls, demonstrating the scaffold infrastructure. Real per-OS
 * title bars (DS §10) arrive with the Tauri shell.
 */
import type { JSX } from 'react';
import { LANGUAGES, LANG_NATIVE, type Language } from '../lib/i18n';
import type { AccentPreference, ThemePreference } from '../lib/theme';
import { useI18n } from '../hooks/useI18n';
import { Icon } from './Icon';

export interface HeaderProps {
  readonly theme: ThemePreference;
  readonly accent: AccentPreference;
  readonly onTheme: (theme: ThemePreference) => void;
  readonly onAccent: (accent: AccentPreference) => void;
}

const THEME_OPTIONS: readonly ThemePreference[] = ['dark', 'light', 'system'];
const ACCENT_OPTIONS: readonly AccentPreference[] = ['auto', 'amber', 'sage', 'graphite'];

export function Header({ theme, accent, onTheme, onAccent }: HeaderProps): JSX.Element {
  const { lang, t, setLanguage } = useI18n();

  return (
    <header className="hdr">
      <div className="hdr-brand">
        <Icon name={theme === 'light' ? 'sun' : 'moon'} size={16} />
        <span className="cap">{t('set.theme')}</span>
        <div className="seg" role="radiogroup" aria-label={t('set.theme')}>
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={opt === theme}
              className={opt === theme ? 'on' : undefined}
              onClick={() => {
                onTheme(opt);
              }}
            >
              {t(`theme.${opt}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="hdr-brand">
        <span className="cap">{t('set.accent')}</span>
        <div className="seg" role="radiogroup" aria-label={t('set.accent')}>
          {ACCENT_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={opt === accent}
              className={opt === accent ? 'on' : undefined}
              onClick={() => {
                onAccent(opt);
              }}
            >
              {t(`accent.${opt}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="hdr-brand">
        <Icon name="globe" size={16} />
        <label className="cap a11y-sr" htmlFor="langSel">
          {t('aria.lang')}
        </label>
        <select
          id="langSel"
          className="select"
          value={lang}
          onChange={(e) => {
            const next = e.target.value;
            if (LANGUAGES.includes(next as Language)) setLanguage(next as Language);
          }}
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {LANG_NATIVE[l]}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}
