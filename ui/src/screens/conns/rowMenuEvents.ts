// SPDX-License-Identifier: GPL-3.0-only

// rowMenuEvents.ts — как открывается меню строки соединения: кнопка «⋯», правая
// кнопка мыши, Shift+F10 и клавиша ContextMenu. Меню всегда привязано к кнопке
// строки: ей возвращается фокус при закрытии (ContextMenu).
import type { KeyboardEvent, MouseEvent } from 'react';
import type { MenuAnchor } from '../../components/ContextMenu';

/** Класс кнопки меню в строке. */
export const MENU_BUTTON = 'conn-menu';

export interface RowMenuEvents {
  readonly onButtonClick: (e: MouseEvent<HTMLButtonElement>) => void;
  readonly onContextMenu: (e: MouseEvent<HTMLTableRowElement>) => void;
  readonly onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => void;
}

const buttonOf = (row: HTMLElement): HTMLButtonElement | null =>
  row.querySelector<HTMLButtonElement>(`button.${MENU_BUTTON}`);

export function rowMenuEvents(open: (anchor: MenuAnchor) => void): RowMenuEvents {
  return {
    onButtonClick: (e): void => {
      const r = e.currentTarget.getBoundingClientRect();
      open({ at: { x: r.left - 160, y: r.bottom + 4 }, trigger: e.currentTarget });
    },
    onContextMenu: (e): void => {
      e.preventDefault();
      const trigger = buttonOf(e.currentTarget);
      if (trigger !== null) open({ at: { x: e.clientX, y: e.clientY }, trigger });
    },
    onKeyDown: (e): void => {
      if (!((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu')) return;
      e.preventDefault();
      buttonOf(e.currentTarget)?.click();
    },
  };
}
