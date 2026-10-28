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
  readonly onImport: () => void;
  readonly onToggleConnect: () => void;
  readonly onOnboarding: () => void;
  readonly onHotkeys: () => void;
  readonly onAbout: () => void;
  readonly onQuit: () => void;
  readonly onClose: () => void;
}

type Item = {
  readonly ic?: IconName;
  readonly label: string;
  readonly kbd?: string;
  readonly danger?: boolean;
  readonly fn: () => void;
} | { readonly sep: true };

export function TitlebarMenu({
  at,
  connected,
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

  useEffect(() => {
    const root = ref.current;
    // Первый пункт получает фокус — меню доступно с клавиатуры.
    root?.querySelector<HTMLElement>('button')?.focus();

    const onDown = (e: MouseEvent): void => {
      if (root !== null && !root.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
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
    { ic: 'download', label: t('menu.file.import'), fn: onImport },
    {
      ic: connected ? 'x' : 'zap',
      label: t(connected ? 'conn.disconnect' : 'conn.connect'),
      kbd: 'Ctrl D',
      fn: onToggleConnect,
    },
    { sep: true },
    { ic: 'zap', label: t('menu.help.onb'), fn: onOnboarding },
    { ic: 'keyboard', label: t('menu.help.hotkeys'), fn: onHotkeys },
    { ic: 'info', label: t('menu.help.about'), fn: onAbout },
    { sep: true },
    { ic: 'x', label: t('menu.file.quit'), danger: true, fn: onQuit },
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
      {items.map((it, i) =>
        'sep' in it ? (
          <div className="menu-sep" key={`sep-${String(i)}`} role="separator" />
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
