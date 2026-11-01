// SPDX-License-Identifier: GPL-3.0-only

// ConnRowMenu.tsx — меню строки соединения: «Копировать адрес», «Создать
// правило» (напрямую / через прокси, если для адреса можно составить правило,
// T-80) и, для активного, «Закрыть соединение». Рисует общий ContextMenu (фокус,
// стрелки, Esc); сами действия — в useConnActions (NOT_FOUND при закрытии
// считается «уже закрыто») и useConnRule.
// Меню рисуется порталом в <body>: внутри экрана position:fixed привязывается к
// блоку с transform от анимации появления, и меню съезжает (как у ProfileMenu).
import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from '../../components/ContextMenu';
import type { MenuAnchor } from '../../components/ContextMenu';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../hooks/useI18n';
import { Connection_Status } from '../../gen/lavray_pb';
import type { Connection } from '../../gen/lavray_pb';
import { ruleFromConnection } from '../../lib/ruleFromConnection';
import type { RuleOutbound } from '../../lib/ruleFromConnection';

export interface ConnRowMenuProps {
  readonly anchor: MenuAnchor;
  readonly conn: Connection;
  readonly onCopy: (conn: Connection) => void;
  readonly onRule: (conn: Connection, out: RuleOutbound) => void;
  readonly onCloseConn: (conn: Connection) => void;
  readonly onDismiss: () => void;
}

export function ConnRowMenu({ anchor, conn, onCopy, onRule, onCloseConn, onDismiss }: ConnRowMenuProps): JSX.Element {
  const { t } = useI18n();
  return createPortal(
    <ContextMenu anchor={anchor} onClose={onDismiss}>
      <button
        type="button"
        className="menu-item"
        role="menuitem"
        onClick={() => {
          onDismiss();
          onCopy(conn);
        }}
      >
        <Icon name="copy" size={16} />
        <span>{t('conns.copy')}</span>
      </button>
      {ruleFromConnection(conn, 'direct') !== null &&
        (['direct', 'proxy'] as const).map((out) => (
          <button
            key={out}
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => {
              onDismiss();
              onRule(conn, out);
            }}
          >
            <Icon name="route" size={16} />
            <span>{t(out === 'direct' ? 'conns.ruleDirect' : 'conns.ruleProxy')}</span>
          </button>
        ))}
      {conn.status === Connection_Status.ACTIVE && (
        <button
          type="button"
          className="menu-item danger"
          role="menuitem"
          onClick={() => {
            onDismiss();
            onCloseConn(conn);
          }}
        >
          <Icon name="x" size={16} />
          <span>{t('conns.close')}</span>
        </button>
      )}
    </ContextMenu>,
    document.body,
  );
}
