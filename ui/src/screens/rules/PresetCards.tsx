// SPDX-License-Identifier: GPL-3.0-only

// PresetCards.tsx — сетка карточек наборов (T-80): клик или Enter/Space
// активирует набор, кнопка «⋯» открывает меню карточки. Карточка — div с
// role="button" (внутри неё своя кнопка меню: вложенные <button> недопустимы).
import type { JSX } from 'react';
import { Icon } from '../../components/Icon';
import type { MenuAnchor } from '../../components/ContextMenu';
import { useI18n } from '../../hooks/useI18n';
import type { RoutingPreset } from '../../gen/lavray_pb';
import { presetDescription, presetRuleCount, presetTitle } from '../../lib/presets';

export interface PresetCardsProps {
  readonly presets: readonly RoutingPreset[];
  readonly activeId: string;
  readonly onActivate: (id: string) => void;
  readonly onMenu: (preset: RoutingPreset, anchor: MenuAnchor) => void;
}

export function PresetCards({ presets, activeId, onActivate, onMenu }: PresetCardsProps): JSX.Element {
  const { t, plural } = useI18n();
  return (
    <div className="preset-grid">
      {presets.length === 0 && (
        <div className="empty" style={{ gridColumn: '1 / -1' }}>
          <Icon name="route" />
          <div className="empty-t">{t('rt.empty.t')}</div>
          <div className="empty-d">{t('rt.empty.d')}</div>
        </div>
      )}
      {presets.map((p) => {
        const on = p.id === activeId;
        const description = presetDescription(p.id, t);
        return (
          <div
            key={p.id}
            className={`preset${on ? ' on' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            onClick={() => { onActivate(p.id); }}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                e.preventDefault();
                onActivate(p.id);
              }
            }}
          >
            <div className="preset-top">
              {on && (
                <span className="preset-check"><Icon name="check" /></span>
              )}
              <h3>{presetTitle(p.id, p.displayName, t)}</h3>
              <span className={`badge ${p.builtin ? 'badge-soft' : 'badge-grad'}`}>
                {t(p.builtin ? 'rt.builtin' : 'rt.mine')}
              </span>
              <button
                type="button"
                className="btn btn-ic btn-sm preset-more"
                aria-label={t('rt.menu')}
                aria-haspopup="menu"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  onMenu(p, { at: { x: r.left - 160, y: r.bottom + 4 }, trigger: e.currentTarget });
                }}
              >
                <Icon name="dots" />
              </button>
            </div>
            {description !== null && <span className="desc">{description}</span>}
            <span className="meta">
              <span className="badge badge-info">{plural('pl.r', presetRuleCount(p))}</span>
              <span className="badge">
                {t('preset.rev')} {p.revision}
              </span>
              {!p.builtin && p.sourceUpdated && <span className="badge badge-warn">{t('rt.sourceUpdated')}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
