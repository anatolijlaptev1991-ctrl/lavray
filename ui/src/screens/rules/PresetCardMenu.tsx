// SPDX-License-Identifier: GPL-3.0-only

// PresetCardMenu.tsx — меню карточки набора (T-80): переименовать, дублировать,
// сбросить к исходному, экспорт, импорт, удалить. Встроенному доступны
// дублирование, экспорт и импорт; сброс — копии со встроенным источником.
// Рисует общий ContextMenu (фокус, стрелки, Esc); в портале на <body>, чтобы
// position:fixed не съезжал внутри экрана с transform.
import { Fragment } from 'react';
import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from '../../components/ContextMenu';
import type { MenuAnchor } from '../../components/ContextMenu';
import { Icon } from '../../components/Icon';
import type { IconName } from '../../components/Icon';
import { useI18n } from '../../hooks/useI18n';
import type { MessageKey } from '../../lib/i18n';
import type { RoutingPreset } from '../../gen/lavray_pb';

export type CardAction = 'rename' | 'duplicate' | 'reset' | 'export' | 'import' | 'delete';

export interface PresetCardMenuProps {
  readonly anchor: MenuAnchor;
  readonly preset: RoutingPreset;
  readonly onAction: (action: CardAction, preset: RoutingPreset) => void;
  readonly onDismiss: () => void;
}

interface Item {
  readonly action: CardAction;
  readonly icon: IconName;
  readonly labelKey: MessageKey;
  readonly danger?: boolean;
}

/** Пункты по порядку; удаление отделено чертой. */
function itemsFor(p: RoutingPreset): readonly Item[] {
  const own = !p.builtin;
  return [
    ...(own ? [{ action: 'rename', icon: 'file', labelKey: 'rt.rename' } as const] : []),
    { action: 'duplicate', icon: 'copy', labelKey: 'rt.duplicate' },
    ...(own && p.builtinSourceId !== '' ? [{ action: 'reset', icon: 'refresh', labelKey: 'rt.resetSource' } as const] : []),
    { action: 'export', icon: 'download', labelKey: 'rt.exportPreset' },
    { action: 'import', icon: 'upload', labelKey: 'rt.importPreset' },
    ...(own ? [{ action: 'delete', icon: 'trash', labelKey: 'rt.deletePreset', danger: true } as const] : []),
  ];
}

export function PresetCardMenu({ anchor, preset, onAction, onDismiss }: PresetCardMenuProps): JSX.Element {
  const { t } = useI18n();
  return createPortal(
    <ContextMenu anchor={anchor} onClose={onDismiss}>
      {itemsFor(preset).map((item) => (
        <Fragment key={item.action}>
          {item.danger === true && <div className="menu-sep" role="separator" />}
          <button
            type="button"
            className={`menu-item${item.danger === true ? ' danger' : ''}`}
            role="menuitem"
            onClick={() => {
              onDismiss();
              onAction(item.action, preset);
            }}
          >
            <Icon name={item.icon} size={16} />
            <span>{t(item.labelKey)}</span>
          </button>
        </Fragment>
      ))}
    </ContextMenu>,
    document.body,
  );
}
