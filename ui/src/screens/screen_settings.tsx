// screen_settings.tsx — «Настройки» (DS §8): язык/тема/акцент, режим
// подключения, DNS-поля, сведения о ядре. Значения — из SettingsService.
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useCore } from '../hooks/useCore';
import { useI18n } from '../hooks/useI18n';

export function SettingsScreen(): JSX.Element {
  const { t, lang, setLanguage } = useI18n();
  const core = useCore();
  const [coreVersion, setCoreVersion] = useState('');
  const [rootVersion, setRootVersion] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const st = await core.core.getStatus({});
        setCoreVersion(st.coreVersion);
        const up = await core.updates.getUpdateState({});
        setRootVersion(up.chainState?.rootVersion ?? 0);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [core]);

  const setSetting = useCallback(
    async (key: string, value: string): Promise<void> => {
      setErr('');
      try {
        await core.settings.setSettings({ values: { [key]: { value: { case: 'stringValue', value } } } });
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [core],
  );

  return (
    <div className="set">
      <h2>{t('nav.settings')}</h2>
      {err !== '' && <div className="toast-err" role="alert">{err}</div>}

      <section className="diag-block">
        <h3>{t('set.lang')}</h3>
        <div className="seg" role="radiogroup" aria-label={t('set.lang')}>
          {(['ru', 'en', 'zh', 'es', 'de'] as const).map((l) => (
            <button key={l} role="radio" aria-checked={lang === l} onClick={() => { setLanguage(l); }}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      <section className="diag-block">
        <h3>{t('set.accent')}</h3>
        <button className="btn" onClick={() => void setSetting('core.underlying_dns', 'local')}>
          {t('set.lang')}
        </button>
      </section>

      <section className="diag-block">
        <h3>{t('lic.title')}</h3>
        <div className="muted mono">
          LAVRay · {t('lic.core')} {coreVersion} · root v{String(rootVersion)}
        </div>
      </section>
    </div>
  );
}
