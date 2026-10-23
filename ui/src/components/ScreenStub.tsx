/**
 * Screen header + stub body for a section tab (DS §7: section title,
 * tab subtitle, tab strip).
 */
import type { JSX } from 'react';
import type { Section, SectionTab } from '../app/sections';
import { useI18n } from '../hooks/useI18n';
import type { MessageKey } from '../lib/i18n';

export interface ScreenStubProps {
  readonly section: Section;
  readonly tab: SectionTab;
  readonly onTab: (tabId: string) => void;
  readonly onConnectDemo: () => void;
}

function tabLabel(tab: SectionTab, t: (k: MessageKey) => string): string {
  return 'key' in tab.label ? t(tab.label.key) : tab.label.literal;
}

export function ScreenStub({ section, tab, onTab, onConnectDemo }: ScreenStubProps): JSX.Element {
  const { t, tf } = useI18n();

  return (
    <div className="scr">
      <div className="scr-head">
        <div>
          <h1>{tabLabel(tab, t)}</h1>
          <p className="sub t3">{t(tab.subKey)}</p>
        </div>
        {section.tabs.length > 1 ? (
          <div className="tabs" role="tablist" aria-label={t(section.navKey)}>
            {section.tabs.map((tb) => (
              <button
                key={tb.id}
                type="button"
                role="tab"
                aria-selected={tb.id === tab.id}
                className={tb.id === tab.id ? 'on' : undefined}
                onClick={() => {
                  onTab(tb.id);
                }}
              >
                {tabLabel(tb, t)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="scr-body">
        <p className="cap mono">
          stub · {section.id}/{tab.id}
        </p>
        <div className="stub-actions">
          <button type="button" className="btn btn-pri" onClick={onConnectDemo}>
            {t('conn.connect')}
          </button>
          <button type="button" className="btn" onClick={onConnectDemo}>
            {t('conn.disconnect')}
          </button>
        </div>
        <p className="cap mono">
          {tf('toast.connected', { name: 'lavray.example' })} · {t('toast.disconnected')}
        </p>
      </div>
    </div>
  );
}
