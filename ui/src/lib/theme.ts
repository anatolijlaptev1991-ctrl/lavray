/**
 * LAVRay theme controller: dark/light + amber/sage/graphite accents.
 *
 * Mirrors the prototype (`resolvedTheme`, `resolvedAccent`, `applyTheme`,
 * `applyAccent`): concrete values are written to `html[data-theme]` and
 * `html[data-accent]`; "auto" accent resolves per theme (dark → amber,
 * light → sage); "system" theme follows `prefers-color-scheme` live.
 * `prefers-reduced-motion` is honored in CSS (base.css) — this module only
 * exposes it for JS-driven choreography.
 */

export type ThemePreference = 'dark' | 'light' | 'system';
export type AccentPreference = 'auto' | 'amber' | 'sage' | 'graphite';
/** Concrete accent value written to the DOM (never "auto"). */
export type ResolvedAccent = 'amber' | 'sage' | 'graphite';

export const THEMES: readonly ThemePreference[] = ['dark', 'light', 'system'];
export const ACCENTS: readonly AccentPreference[] = ['auto', 'amber', 'sage', 'graphite'];

const THEME_KEY = 'lavray.theme';
const ACCENT_KEY = 'lavray.accent';

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'dark' || v === 'light' || v === 'system';
}

export function isAccentPreference(v: unknown): v is AccentPreference {
  return v === 'auto' || v === 'amber' || v === 'sage' || v === 'graphite';
}

/** OS preference via matchMedia (false → light), prototype `resolvedTheme`. */
export function systemPrefersDark(win: Window): boolean {
  return win.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolvedTheme(pref: ThemePreference, win: Window): 'dark' | 'light' {
  return pref === 'system' ? (systemPrefersDark(win) ? 'dark' : 'light') : pref;
}

/** "auto" is theme-bound: dark → amber, light → sage (DS §2). */
export function resolvedAccent(pref: AccentPreference, theme: 'dark' | 'light'): ResolvedAccent {
  if (pref !== 'auto') return pref;
  return theme === 'dark' ? 'amber' : 'sage';
}

/** True when the user asked the OS to reduce motion (DS §11–12). */
export function prefersReducedMotion(win: Window): boolean {
  return win.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Persisted preferences read once at startup (defaults: dark / auto). */
export function loadPreferences(storage: Storage): { theme: ThemePreference; accent: AccentPreference } {
  let theme: ThemePreference = 'dark';
  let accent: AccentPreference = 'auto';
  try {
    const t = storage.getItem(THEME_KEY);
    if (isThemePreference(t)) theme = t;
    const a = storage.getItem(ACCENT_KEY);
    if (isAccentPreference(a)) accent = a;
  } catch {
    /* storage unavailable (private mode etc.) — keep defaults */
  }
  return { theme, accent };
}

function save(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export interface ApplyOptions {
  readonly doc: Document;
  readonly win: Window;
  readonly storage: Storage;
  readonly theme: ThemePreference;
  readonly accent: AccentPreference;
}

/** Write concrete `data-theme` / `data-accent` on <html> and persist the choice. */
export function applyTheme(opts: ApplyOptions): { theme: 'dark' | 'light'; accent: ResolvedAccent } {
  const theme = resolvedTheme(opts.theme, opts.win);
  const accent = resolvedAccent(opts.accent, theme);
  opts.doc.documentElement.dataset.theme = theme;
  opts.doc.documentElement.dataset.accent = accent;
  save(opts.storage, THEME_KEY, opts.theme);
  save(opts.storage, ACCENT_KEY, opts.accent);
  return { theme, accent };
}

/**
 * Follow live OS theme changes while the preference is "system"
 * (prototype: mql change listener). Returns a disposer.
 */
export function watchSystemTheme(
  win: Window,
  onChange: (theme: 'dark' | 'light') => void,
): () => void {
  const mql = win.matchMedia('(prefers-color-scheme: dark)');
  const listener = (e: MediaQueryListEvent): void => {
    onChange(e.matches ? 'dark' : 'light');
  };
  mql.addEventListener('change', listener);
  return () => {
    mql.removeEventListener('change', listener);
  };
}
