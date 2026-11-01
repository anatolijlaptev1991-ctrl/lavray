// SPDX-License-Identifier: GPL-3.0-only

// RowMenu.tsx — меню строки профиля на экране «Серверы» (прототип profileMenu):
// ссылка, QR-код, проверка задержки, перенос в группу, дублирование, сброс
// трафика, разрешение доменов, экспорт конфига и удаление. Вынесено из
// screen_servers.tsx (размерная трещотка); действия выполняет экран, меню лишь
// закрывается перед ними.
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { ContextMenu } from '../ContextMenu';
import type { MenuAnchor } from '../ContextMenu';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import type { MessageKey } from '../../lib/i18n';

/** Действия над одним профилем, которые выполняет useProfileActions. */
export type RowAction = 'move' | 'clone' | 'resetTraffic' | 'resolve' | 'export';

const ACTIONS: readonly { readonly action: RowAction; readonly icon: IconName; readonly labelKey: MessageKey }[] = [
  { action: 'move', icon: 'layers', labelKey: 'srv.menu.move' },
  { action: 'clone', icon: 'copy', labelKey: 'srv.menu.clone' },
  { action: 'resolve', icon: 'globe', labelKey: 'srv.menu.resolve' },
  { action: 'resetTraffic', icon: 'refresh', labelKey: 'srv.menu.resetTraffic' },
  { action: 'export', icon: 'download', labelKey: 'srv.menu.export' },
];

interface Props {
  readonly anchor: MenuAnchor;
  readonly onClose: () => void;
  readonly onCopyLink: () => void;
  readonly onShowQr: () => void;
  readonly onTestLatency: () => void;
  readonly onDelete: () => void;
  readonly onAction: (action: RowAction) => void;
}

export function RowMenu({ anchor, onClose, onCopyLink, onShowQr, onTestLatency, onDelete, onAction }: Props): JSX.Element {
  const { t } = useI18n();
  /** Пункт: сначала закрыть меню, потом действие. */
  const item = (icon: IconName, label: string, action: () => void, danger = false): JSX.Element => (
    <button
      key={label}
      className={danger ? 'menu-item danger' : 'menu-item'}
      role="menuitem"
      onClick={() => {
        onClose();
        action();
      }}
    >
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </button>
  );
  return (
    <ContextMenu anchor={anchor} onClose={onClose}>
      {item('copy', t('common.copyLink'), onCopyLink)}
      {item('qr', t('qr.show'), onShowQr)}
      {item('gauge', t('common.testLatency'), onTestLatency)}
      <div className="menu-sep" role="separator" />
      {ACTIONS.map((a) =>
        item(a.icon, t(a.labelKey), () => {
          onAction(a.action);
        }),
      )}
      <div className="menu-sep" role="separator" />
      {item('trash', t('common.delete'), onDelete, true)}
    </ContextMenu>
  );
}
