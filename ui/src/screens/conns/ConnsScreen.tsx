// SPDX-License-Identifier: GPL-3.0-only

// ConnsScreen.tsx — «Соединения» (DS §8, FR-UI-274/271/213, T-79): активные и
// закрытые (история копится в UI из closedIds) соединения с байтами, цепочкой
// исходящих и статусом. Чипы «Все / Прокси / Напрямую / Блок», поиск, пауза,
// меню строки (копировать адрес, закрыть). Пустой список — обычное состояние.
import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { MenuAnchor } from '../../components/ContextMenu';
import { Icon } from '../../components/Icon';
import { useConnActions } from '../../hooks/useConnActions';
import type { ConnNote } from '../../hooks/useConnActions';
import { useConnRule } from '../../hooks/useConnRule';
import { useConnections } from '../../hooks/useConnections';
import { useI18n } from '../../hooks/useI18n';
import type { Connection } from '../../gen/lavray_pb';
import { filterConns } from '../../lib/conns/filter';
import type { ConnChip } from '../../lib/conns/filter';
import { ConnRowMenu } from './ConnRowMenu';
import { ConnsTable } from './ConnsTable';
import { ConnsToolbar } from './ConnsToolbar';
import { RuleCopyDialog } from './RuleCopyDialog';

export interface ConnsScreenProps {
  /** Приложение подключено: только тогда есть что показывать и на что подписываться. */
  readonly active: boolean;
}

interface OpenMenu {
  readonly anchor: MenuAnchor;
  readonly conn: Connection;
}

export function ConnsScreen({ active }: ConnsScreenProps): JSX.Element {
  const { view, paused, setPaused, error } = useConnections(active);
  const actions = useConnActions();
  const rule = useConnRule(actions.notify);
  const [chip, setChip] = useState<ConnChip>('all');
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  // Активные, затем закрытые; чип и поиск применяются к обоим спискам.
  const live = useMemo(() => filterConns(view.active, chip, query), [view.active, chip, query]);
  const closed = useMemo(() => filterConns(view.closed.items, chip, query), [view.closed.items, chip, query]);
  const rows = useMemo(() => [...live, ...closed], [live, closed]);
  const hasAny = view.active.length + view.closed.items.length > 0;

  return (
    <div className="conns">
      {error !== '' && <StreamBanner error={error} />}
      {actions.note !== null && <ActionNote note={actions.note} />}
      <ConnsToolbar
        chip={chip}
        onChip={setChip}
        query={query}
        onQuery={setQuery}
        activeCount={live.length}
        closedCount={closed.length}
        truncated={view.truncated}
        paused={paused}
        onPause={setPaused}
      />
      {rows.length === 0 ? (
        <EmptyState active={active} hasAny={hasAny} />
      ) : (
        <ConnsTable rows={rows} nowMs={view.nowMs} onMenu={(conn, anchor) => { setMenu({ conn, anchor }); }} />
      )}
      {menu !== null && (
        <ConnRowMenu
          anchor={menu.anchor}
          conn={menu.conn}
          onCopy={(c) => void actions.copyAddress(c)}
          onRule={(c, out) => void rule.start(c, out)}
          onCloseConn={(c) => void actions.closeConnection(c)}
          onDismiss={() => { setMenu(null); }}
        />
      )}
      {rule.pending !== null && (
        <RuleCopyDialog pending={rule.pending} onConfirm={() => void rule.confirmCopy()} onClose={rule.cancel} />
      )}
    </div>
  );
}

/** Обрыв потока: причина и пометка, что переподключение идёт само. */
function StreamBanner({ error }: { readonly error: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="banner banner-err" role="alert">
      <span className="ic">
        <Icon name="alert" />
      </span>
      <div className="bn-t">
        {error} <span className="cap">{t('conns.retrying')}</span>
      </div>
    </div>
  );
}

/** Итог копирования или сбой закрытия; гаснет сам (useConnActions). */
function ActionNote({ note }: { readonly note: ConnNote }): JSX.Element {
  return note.kind === 'ok' ? (
    <div className="toast-ok" role="status">
      {note.text}
    </div>
  ) : (
    <div className="banner banner-err" role="alert">
      <span className="ic">
        <Icon name="alert" />
      </span>
      <div className="bn-t">{note.text}</div>
    </div>
  );
}

/** Пусто — не ошибка: нет подключения, ещё нет трафика или фильтр всё скрыл. */
function EmptyState({ active, hasAny }: { readonly active: boolean; readonly hasAny: boolean }): JSX.Element {
  const { t } = useI18n();
  const text = hasAny ? t('conns.noMatch') : active ? t('conns.emptyOn') : t('conns.empty');
  return (
    <div className="empty">
      <Icon name="activity" />
      <div className="empty-t">{t('conns.caption')}</div>
      <div className="empty-d">{text}</div>
    </div>
  );
}
