// SPDX-License-Identifier: GPL-3.0-only

// RowMenu.tsx — меню строки профиля на экране «Серверы» (прототип profileMenu):
// ссылка, QR-код, проверка задержки, удаление. Вынесено из screen_servers.tsx
// (размерная трещотка); действия выполняет экран, меню лишь закрывается перед ними.
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { ContextMenu } from '../ContextMenu';
import type { MenuAnchor } from '../ContextMenu';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';

interface Props {
  readonly anchor: MenuAnchor;
  readonly onClose: () => void;
  readonly onCopyLink: () => void;
  readonly onShowQr: () => void;
  readonly onTestLatency: () => void;
  readonly onDelete: () => void;
}

export function RowMenu({ anchor, onClose, onCopyLink, onShowQr, onTestLatency, onDelete }: Props): JSX.Element {
  const { t } = useI18n();
  /** Пункт: сначала закрыть меню, потом действие. */
  const item = (icon: IconName, label: string, action: () => void, danger = false): JSX.Element => (
    <button
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
      {item('trash', t('common.delete'), onDelete, true)}
    </ContextMenu>
  );
}
