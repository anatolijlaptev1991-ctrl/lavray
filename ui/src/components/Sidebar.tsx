/**
 * Sidebar: the five sections (DS §7). Labels via i18n; keyboard access
 * via Ctrl/⌘+1…5 is handled in App.
 */
import type { JSX } from 'react';
import { Icon } from './Icon';
import { SECTIONS, type Section } from '../app/sections';
import { useI18n } from '../hooks/useI18n';

export interface SidebarProps {
  readonly active: string;
  readonly onSelect: (id: string) => void;
}

export function Sidebar({ active, onSelect }: SidebarProps): JSX.Element {
  const { t } = useI18n();

  const item = (s: Section): JSX.Element => (
    <button
      key={s.id}
      type="button"
      className={s.id === active ? 'sb-item on' : 'sb-item'}
      aria-current={s.id === active ? 'page' : undefined}
      onClick={() => {
        onSelect(s.id);
      }}
    >
      <Icon name={s.icon} />
      <span className="sb-l">{t(s.navKey)}</span>
    </button>
  );

  return (
    <nav className="sidebar" aria-label={t('aria.nav')}>
      <div className="sb-brand">
        <span className="sb-logo" aria-hidden="true" />
        LAVRay
      </div>
      <div className="sb-items">{SECTIONS.map(item)}</div>
      <div className="sb-foot cap">UI scaffold · stage 3</div>
    </nav>
  );
}
