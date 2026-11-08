// SPDX-License-Identifier: GPL-3.0-only

// ConnsTable.tsx — таблица соединений: адрес (и приложение), цепочка исходящих,
// правило, сеть, ↑/↓ байты, длительность, статус и кнопка меню строки. Закрытые
// строки приглушены. Меню открывается кнопкой, правой кнопкой и с клавиатуры
// (rowMenuEvents.ts).
import { memo } from 'react';
import type { JSX } from 'react';
import { Icon } from '../../components/Icon';
import type { MenuAnchor } from '../../components/ContextMenu';
import { useI18n } from '../../hooks/useI18n';
import { Connection_Status } from '../../gen/lavray_pb';
import type { Connection } from '../../gen/lavray_pb';
import { chainText, formatConnBytes, formatConnDuration } from '../../lib/conns/format';
import type { MessageKey } from '../../lib/i18n';
import { ConnStatusIcon } from './ConnStatusIcon';
import { MENU_BUTTON, rowMenuEvents } from './rowMenuEvents';
import { sameRow } from './sameRow';
import type { RowProps as RowPropsBase } from './sameRow';

const COLUMNS: readonly MessageKey[] = [
  'conns.col.host',
  'conns.col.out',
  'conns.col.rule',
  'conns.col.net',
  'conns.col.up',
  'conns.col.down',
  'conns.col.dur',
  'conns.col.status',
];

type OpenMenu = (conn: Connection, anchor: MenuAnchor) => void;

export interface ConnsTableProps {
  readonly rows: readonly Connection[];
  /** «Сейчас» для длительности активных (время последнего кадра). */
  readonly nowMs: number;
  readonly onMenu: OpenMenu;
}

export function ConnsTable({ rows, nowMs, onMenu }: ConnsTableProps): JSX.Element {
  const { t, lang } = useI18n();
  return (
    <div className="log-wrap">
      <table className="conns-table">
        <caption className="sr-only">{t('conns.caption')}</caption>
        <thead>
          <tr>
            {COLUMNS.map((key) => (
              <th key={key} scope="col">
                {t(key)}
              </th>
            ))}
            <th scope="col">
              <span className="sr-only">{t('conns.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <ConnRow key={c.id} conn={c} duration={formatConnDuration(c, nowMs, lang)} onMenu={onMenu} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

type RowProps = Omit<RowPropsBase, 'onMenu'> & { readonly onMenu: OpenMenu };

const ConnRow = memo(function ConnRow({ conn: c, duration, onMenu }: RowProps): JSX.Element {
  const { t, lang } = useI18n();
  const chain = chainText(c);
  const events = rowMenuEvents((anchor) => {
    onMenu(c, anchor);
  });
  const process = c.process ?? '';
  return (
    <tr
      className={c.status === Connection_Status.ACTIVE ? undefined : 'muted'}
      onContextMenu={events.onContextMenu}
      onKeyDown={events.onKeyDown}
    >
      <td className="mono" title={c.resolvedDestination ?? c.destination}>
        {c.destination}
        {process !== '' && <span className="cap conn-proc"> · {process}</span>}
      </td>
      <td className="mono" title={chain}>
        {chain}
      </td>
      <td className="mono" title={c.rule}>
        {c.rule ?? '—'}
      </td>
      <td className="mono">{c.network}</td>
      <td className="mono">{formatConnBytes(c.uploadBytes, lang)}</td>
      <td className="mono">{formatConnBytes(c.downloadBytes, lang)}</td>
      <td className="mono">{duration}</td>
      <td>
        <ConnStatusIcon status={c.status} />
      </td>
      <td>
        <button
          type="button"
          className={`btn btn-ic btn-sm ${MENU_BUTTON}`}
          aria-label={t('conns.actions')}
          title={t('conns.actions')}
          aria-haspopup="menu"
          onClick={events.onButtonClick}
        >
          <Icon name="dots" />
        </button>
      </td>
    </tr>
  );
}, sameRow);
