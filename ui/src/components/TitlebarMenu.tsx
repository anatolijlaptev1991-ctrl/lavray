// TitlebarMenu.tsx — меню титлбара (прототип `tbMenuItems()`).
// Состав: импорт подписки, подключить/отключить, разделитель, первый запуск,
// горячие клавиши, о программе, разделитель, выход.
import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { Icon, type IconName } from './Icon';
import { useI18n } from '../hooks/useI18n';

export interface TitlebarMenuProps {
  /** Точка привязки (левый нижний угол кнопки). */
  readonly at: { readonly x: number; readonly y: number };
  /** Ядро подключено — меняет подпись и иконку пункта. */
  readonly connected: boolean;
  /** ОС: от неё зависит обозначение модификатора (⌘ на macOS). */
  readonly os: string;
  readonly onImport: () => void;
  readonly onToggleConnect: () => void;
  readonly onOnboarding: () => void;
  readonly onHotkeys: () => void;
  readonly onAbout: () => void;
  readonly onQuit: () => void;
  readonly onClose: () => void;
}

interface MenuAction {
  readonly kind: 'item';
  readonly ic?: IconName;
  readonly label: string;
  readonly kbd?: string;
  readonly danger?: boolean;
  readonly fn: () => void;
}

interface MenuSep {
  readonly kind: 'sep';
  readonly id: string;
}

type Item = MenuAction | MenuSep;

export function TitlebarMenu({
  at,
  connected,
  os,
  onImport,
  onToggleConnect,
  onOnboarding,
  onHotkeys,
  onAbout,
  onQuit,
  onClose,
}: TitlebarMenuProps): JSX.Element {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  // Модификатор по конвенции ОС (прототип: kbdLabel('D')).
  const mod = os === 'macos' ? '⌘' : 'Ctrl';

  useEffect(() => {
    const root = ref.current;
    const buttons = (): HTMLElement[] =>
      Array.from(root?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

    // Фокус ставится только при открытии: раньше эффект зависел от
    // нестабильного onClose и перезапускался каждую секунду (опрос
    // статуса), возвращая фокус на первый пункт.
    buttons()[0]?.focus();

    const onDown = (e: MouseEvent): void => {
      if (root !== null && !root.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      const list = buttons();
      const idx = list.indexOf(document.activeElement as HTMLElement);
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          return;
        case 'ArrowDown':
          e.preventDefault();
          list[(idx + 1) % list.length]?.focus();
          return;
        case 'ArrowUp':
          e.preventDefault();
          list[(idx - 1 + list.length) % list.length]?.focus();
          return;
        case 'Home':
          e.preventDefault();
          list[0]?.focus();
          return;
        case 'End':
          e.preventDefault();
          list[list.length - 1]?.focus();
          return;
        default:
          break;
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const items: readonly Item[] = [
    { kind: 'item', ic: 'download', label: t('menu.file.import'), fn: onImport },
    {
      kind: 'item',
      // Прототип использует `power` при активном соединении.
      ic: connected ? 'power' : 'zap',
      label: t(connected ? 'conn.disconnect' : 'conn.connect'),
      kbd: `${mod} D`,
      fn: onToggleConnect,
    },
    { kind: 'sep', id: 's1' },
    { kind: 'item', ic: 'zap', label: t('menu.help.onb'), fn: onOnboarding },
    { kind: 'item', ic: 'keyboard', label: t('menu.help.hotkeys'), fn: onHotkeys },
    { kind: 'item', ic: 'info', label: t('menu.help.about'), fn: onAbout },
    { kind: 'sep', id: 's2' },
    { kind: 'item', ic: 'x', label: t('menu.file.quit'), danger: true, fn: onQuit },
  ];

  return (
    <div
      className="menu"
      role="menu"
      ref={ref}
      style={{ left: at.x, top: at.y }}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
    >
      {items.map((it) =>
        it.kind === 'sep' ? (
          <div className="menu-sep" key={it.id} role="separator" />
        ) : (
          <button
            key={it.label}
            className={it.danger === true ? 'menu-item danger' : 'menu-item'}
            role="menuitem"
            onClick={() => {
              onClose();
              it.fn();
            }}
          >
            {it.ic !== undefined && <Icon name={it.ic} size={16} />}
            <span>{it.label}</span>
            {it.kbd !== undefined && <span className="mi-kbd">{it.kbd}</span>}
          </button>
        ),
      )}
    </div>
  );
}
