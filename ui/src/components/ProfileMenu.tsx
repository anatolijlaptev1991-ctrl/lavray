// ProfileMenu.tsx — меню выбора сервера на экране «Подключение» (прототип:
// #profilePick → openMenu). Серверы по возрастанию задержки (без замера — в
// конце), у выбранного отметка ✓, внизу «Все серверы…». Рисуется порталом в
// <body>, как меню прототипа: внутри экрана position:fixed привязывается к
// блоку с transform от анимации появления, и меню съезжает.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Profile } from '../gen/lavray_pb';
import { useI18n } from '../hooks/useI18n';
import { latencyMsOf, sortByLatency } from '../lib/connection';
import { formatMs } from '../lib/i18n';
import { profileTypeLabel } from '../lib/profileType';
import { Icon } from './Icon';

export interface ProfileMenuAnchor {
  readonly left: number;
  readonly bottom: number;
  readonly width: number;
}

export interface ProfileMenuProps {
  readonly anchor: ProfileMenuAnchor;
  readonly profiles: readonly Profile[];
  readonly selectedId: bigint | undefined;
  readonly onSelect: (profile: Profile) => void;
  readonly onAllServers: () => void;
  /** restoreFocus: вернуть фокус на кнопку-триггер (Esc, выбор пункта). */
  readonly onClose: (restoreFocus: boolean) => void;
}

const ITEM_SELECTOR = '[role^="menuitem"]';

export function ProfileMenu({
  anchor,
  profiles,
  selectedId,
  onSelect,
  onAllServers,
  onClose,
}: ProfileMenuProps): JSX.Element {
  const { t, lang } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  // Родитель перерисовывается раз в секунду (опрос статуса) и передаёт новые
  // замыкания: эффекты ниже читают их через ref и не перезапускаются.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const sorted = useMemo(() => sortByLatency(profiles), [profiles]);

  // Не даём меню выйти за правый край окна.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const width = el.getBoundingClientRect().width;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
    el.style.left = `${String(left)}px`;
  }, [anchor.left]);

  // Фокус — на выбранный пункт (иначе на первый); клик вне меню закрывает,
  // кроме клика по самому триггеру: он закрывает меню сам (без «закрыл и тут
  // же открыл заново»).
  useEffect(() => {
    const root = ref.current;
    const items = Array.from(root?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    const checked = items.find((el) => el.getAttribute('aria-checked') === 'true');
    (checked ?? items[0])?.focus();
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Element | null;
      if (
        root !== null &&
        target !== null &&
        !root.contains(target) &&
        target.closest('[aria-haspopup="menu"]') === null
      ) {
        onCloseRef.current(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return (): void => {
      document.removeEventListener('mousedown', onDown);
    };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        items[(at + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        items[at <= 0 ? items.length - 1 : at - 1]?.focus();
        break;
      case 'Home':
        e.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose(true);
        break;
      case 'Tab':
        onClose(false);
        break;
      default:
        break;
    }
  };

  return createPortal(
    <div
      className="menu"
      role="menu"
      aria-label={t('srv.current')}
      ref={ref}
      onKeyDown={onKeyDown}
      style={{
        left: anchor.left,
        top: anchor.bottom + 6,
        minWidth: Math.max(260, anchor.width),
        maxHeight: Math.max(160, window.innerHeight - anchor.bottom - 16),
        overflowY: 'auto',
      }}
    >
      {sorted.map((p) => {
        const ms = latencyMsOf(p);
        const checked = p.id === selectedId;
        return (
          <button
            key={String(p.id)}
            className="menu-item"
            role="menuitemradio"
            aria-checked={checked}
            tabIndex={-1}
            onClick={() => {
              onCloseRef.current(true);
              onSelect(p);
            }}
          >
            {checked ? <Icon name="check" size={16} /> : <span style={{ width: 15, flex: 'none' }} />}
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.name}
            </span>
            <span className="mi-kbd">
              {profileTypeLabel(p.type, t)} · {ms === null ? '—' : formatMs(ms, lang)}
            </span>
          </button>
        );
      })}
      <div className="menu-sep" role="separator" />
      <button
        className="menu-item"
        role="menuitem"
        tabIndex={-1}
        onClick={() => {
          onCloseRef.current(false);
          onAllServers();
        }}
      >
        <Icon name="layers" size={16} />
        <span>{t('srv.all')}</span>
      </button>
    </div>,
    document.body,
  );
}
