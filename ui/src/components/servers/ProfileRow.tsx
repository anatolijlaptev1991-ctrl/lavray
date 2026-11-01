// SPDX-License-Identifier: GPL-3.0-only

// ProfileRow.tsx — строка сервера на экране «Серверы» (прототип .prow): выбор,
// избранное, имя с бейджами (тип, «не поддерживается ядром», «Активен»), задержка,
// меню «≡» и удаление. Вынесено из screen_servers.tsx (размерная трещотка).
import { useRef } from 'react';
import type { JSX } from 'react';
import type { Profile } from '../../gen/lavray_pb';
import { useI18n } from '../../hooks/useI18n';
import { formatMs } from '../../lib/i18n';
import { formatFullReport, isTestDown, isTestNotApplicable } from '../../lib/testResult';
import type { MenuAnchor } from '../ContextMenu';
import { Icon } from '../Icon';
import { CustomBadge } from './CustomBadge';
import { UnsupportedBadge } from './UnsupportedBadge';

export interface RowProps {
  readonly p: Profile;
  readonly compact: boolean;
  readonly checked: boolean;
  readonly latencyLabel: string | undefined;
  /** Строка отчёта полного теста из текущего прогона; undefined — брать из профиля. */
  readonly reportLabel: string | undefined;
  readonly onCheck: (on: boolean) => void;
  readonly onEdit: () => void;
  readonly onFav: () => void;
  readonly onDelete: () => void;
  /** Custom-поля подтверждены: список перечитывается, бейдж «не подтверждено» уходит. */
  readonly onCustomConfirmed: () => void;
  /** Меню строки открыто: aria-expanded у кнопки «≡». */
  readonly menuOpen: boolean;
  /** Меню строки (копировать ссылку / тест / удалить): прототип profileMenu. */
  readonly onRowMenu: (anchor: MenuAnchor) => void;
  /** Бейдж типа: подпись и суффикс класса (.badge.bt-<cls>). */
  readonly badge: { readonly cls: string; readonly label: string };
  /** Сервер подключён/подключается прямо сейчас — бейдж «Активен». */
  readonly active: boolean;
  readonly activeDot: 'ok' | 'warn';
}

export function ProfileRow({
  p,
  compact,
  checked,
  latencyLabel,
  reportLabel,
  onCheck,
  onEdit,
  onFav,
  onDelete,
  onCustomConfirmed,
  menuOpen,
  onRowMenu,
  badge,
  active,
  activeDot,
}: RowProps): JSX.Element {
  const { t, tf, lang } = useI18n();
  const moreRef = useRef<HTMLButtonElement | null>(null);
  // Меню строки привязано к кнопке «≡» (прототип: row.querySelector('[data-menu-p]').click()).
  const openMenu = (): void => {
    const btn = moreRef.current;
    if (btn === null) return;
    const r = btn.getBoundingClientRect();
    onRowMenu({ at: { x: r.left - 160, y: r.bottom + 4 }, trigger: btn });
  };
  const ms = p.testResult?.latencyMs;
  const na = isTestNotApplicable(p.testResult);
  const delay =
    latencyLabel ?? (na ? t('test.na') : ms !== undefined && ms > 0 ? formatMs(ms, lang) : '—');
  const down = isTestDown(p.testResult);
  const report = reportLabel ?? formatFullReport(p.testResult?.fullReport, t, lang);
  return (
    <li
      className={`prow${checked ? ' sel' : ''}${active ? ' active' : ''}`}
      onKeyDown={(e) => {
        // Shift+F10 и клавиша ContextMenu открывают меню строки.
        if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
          e.preventDefault();
          openMenu();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu();
      }}
    >
      <input
        type="checkbox"
        className="prow-chk"
        checked={checked}
        aria-label={tf('srv.select', { name: p.name })}
        onChange={(e) => {
          onCheck(e.target.checked);
        }}
      />
      <button
        className={`prow-fav${p.favorite ? ' on' : ''}`}
        aria-label={p.favorite ? t('prof.favRm') : t('prof.favAdd')}
        title={p.favorite ? t('prof.favRm') : t('prof.favAdd')}
        onClick={onFav}
      >
        <Icon name="star" />
      </button>
      <button className="prow-main" onClick={onEdit} title={p.name}>
        <span className="prow-title">
          <span className="prow-name">{p.name}</span>
          <span className={`badge bt-${badge.cls}`}>{badge.label}</span>
          <UnsupportedBadge reason={p.unsupportedReason} />
          {!compact &&
            p.tags.map((tag) => (
              <span className="p-tag" key={tag}>
                {tag}
              </span>
            ))}
          {active && (
            <span className="badge badge-ok">
              <span className={`dot ${activeDot}`} />
              {t('srv.active')}
            </span>
          )}
        </span>
        {!compact && p.address !== '' && (
          <span className="prow-addr mono">
            {p.address}:{String(p.port)}
          </span>
        )}
      </button>
      <CustomBadge profile={p} onConfirmed={onCustomConfirmed} />
      <span className="prow-res">
        <span className={`prow-lat mono${down ? ' err' : delay === '—' ? ' na' : ''}`}>{delay}</span>
        {report !== '' && (
          <span className="prow-rep mono" title={report}>
            {report}
          </span>
        )}
      </span>
      <button
        className="prow-more btn btn-ic btn-sm"
        aria-label={t('aria.menu')}
        title={t('aria.menu')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        ref={moreRef}
        onClick={openMenu}
      >
        <Icon name="dots" size={16} />
      </button>
      <button
        className="prow-del btn btn-ic btn-sm"
        aria-label={t('common.delete')}
        title={t('common.delete')}
        onClick={onDelete}
      >
        <Icon name="trash" />
      </button>
    </li>
  );
}
