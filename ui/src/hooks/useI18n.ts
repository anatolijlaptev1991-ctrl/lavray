/**
 * React binding for the i18n module: subscribes to language switches
 * without reloading (DS §9).
 */
import { useCallback, useSyncExternalStore } from 'react';
import {
  applyDocumentLanguage,
  getLanguage,
  onLanguageChange,
  setLanguage as setLang,
  t as translate,
  tf as translateFormat,
  type Language,
  type MessageKey,
} from '../lib/i18n';

export interface I18nApi {
  readonly lang: Language;
  readonly t: (key: MessageKey) => string;
  readonly tf: (key: MessageKey, params: Readonly<Record<string, string | number>>) => string;
  readonly setLanguage: (lang: Language) => void;
}

export function useI18n(): I18nApi {
  const lang = useSyncExternalStore(onLanguageChange, getLanguage, getLanguage);

  const t = useCallback((key: MessageKey): string => translate(key, lang), [lang]);
  const tf = useCallback(
    (key: MessageKey, params: Readonly<Record<string, string | number>>): string =>
      translateFormat(key, params, lang),
    [lang],
  );
  const setLanguage = useCallback((next: Language): void => {
    setLang(next);
    applyDocumentLanguage(document);
  }, []);

  return { lang, t, tf, setLanguage };
}
