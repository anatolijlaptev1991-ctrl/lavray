// SPDX-License-Identifier: GPL-3.0-only

// ContextMenu.tsx — всплывающее меню по openMenu() прототипа
// (design/prototype.html ~3600–3647): при открытии фокус на первом пункте;
// ↑/↓ по кругу, Home/End, переход по первой букве; Esc закрывает и возвращает
// фокус на кнопку-открывалку; Tab закрывает, и фокус идёт дальше от этой кнопки;
// клик вне меню закрывает; меню зажато в пределах окна. Пункты — элементы
// role="menuitem" в children, их действия и закрытие по ним — у вызывающего.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';

/** Где открыть меню и кому вернуть фокус при закрытии. */
export interface MenuAnchor {
  readonly at: { readonly x: number; readonly y: number };
  readonly trigger: HTMLElement;
}

export interface ContextMenuProps {
  readonly anchor: MenuAnchor;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** Минимальный отступ меню от края окна (прототип: 8 px). */
const EDGE = 8;

const itemsOf = (root: HTMLElement | null): HTMLElement[] =>
  Array.from(root?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

export function ContextMenu({ anchor, onClose, children }: ContextMenuProps): JSX.Element {
  const { at, trigger } = anchor;
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  // Слушатель клика вне меню всегда зовёт актуальный onClose.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Зажим в окне: размеры меню известны только после раскладки.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    setPos({
      left: Math.max(EDGE, Math.min(at.x, window.innerWidth - (box?.width ?? 0) - EDGE)),
      top: Math.max(EDGE, Math.min(at.y, window.innerHeight - (box?.height ?? 0) - EDGE)),
    });
  }, [at.x, at.y]);

  // Фокус на первый пункт при открытии; клик вне меню (и вне кнопки-открывалки,
  // у неё свой переключатель) закрывает.
  useEffect(() => {
    itemsOf(ref.current)[0]?.focus();
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (ref.current?.contains(target) === true || trigger.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener('mousedown', onDown);
    return (): void => {
      document.removeEventListener('mousedown', onDown);
    };
  }, [trigger]);

  const closeAndRestoreFocus = (): void => {
    trigger.focus();
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const list = itemsOf(ref.current);
    const cur = list.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        list[(cur + 1) % list.length]?.focus();
        return;
      case 'ArrowUp':
        e.preventDefault();
        list[cur <= 0 ? list.length - 1 : cur - 1]?.focus();
        return;
      case 'Home':
        e.preventDefault();
        list[0]?.focus();
        return;
      case 'End':
        e.preventDefault();
        list[list.length - 1]?.focus();
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        closeAndRestoreFocus();
        return;
      case 'Tab':
        // Без preventDefault: Tab продолжит путь от кнопки-открывалки.
        closeAndRestoreFocus();
        return;
      default:
        if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.altKey && !e.metaKey) {
          const c = e.key.toLowerCase();
          [...list.slice(cur + 1), ...list.slice(0, cur + 1)]
            .find((el) => (el.textContent ?? '').trim().toLowerCase().startsWith(c))
            ?.focus();
        }
    }
  };

  return (
    <div
      className="menu"
      role="menu"
      ref={ref}
      aria-label={trigger.getAttribute('aria-label') ?? undefined}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
      onClickCapture={(e: ReactMouseEvent<HTMLDivElement>) => {
        // Выбор пункта возвращает фокус на кнопку-открывалку ДО действия
        // (closeMenus(true) прототипа): действие может открыть диалог.
        if ((e.target as HTMLElement).closest('[role^="menuitem"]') !== null) trigger.focus();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
    >
      {children}
    </div>
  );
}
