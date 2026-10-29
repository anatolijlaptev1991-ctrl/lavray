// useModal.ts — поведение модального диалога: фокус при открытии, Esc,
// ловушка Tab. Общий код для DialogShell и ImportDialog.
//
// T-05: колбэки читаются через latest-ref, а эффект выполняется ОДИН раз при
// монтировании. Раньше onClose входил в зависимости эффекта; родители
// передают его новой стрелкой на каждый рендер, а AppInner перерисовывается
// раз в секунду (опрос статуса ядра) — эффект перезапускался и каждый раз
// возвращал фокус в корень диалога или в первое поле, так что набрать имя
// группы или подписки было невозможно.
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Открытые диалоги; последний — верхний. Esc и Tab обрабатывает только
 * верхний (T-12): подтверждение удаления поверх «Групп» закрывается своим Esc,
 * не закрывая нижний диалог, и ловушка Tab не борется за фокус с нижним.
 */
const openModals: object[] = [];

export interface ModalOptions {
  /** Вызывается по Esc. Можно передавать новую стрелку на каждый рендер. */
  readonly onClose: () => void;
  /** Куда ставить фокус при открытии; по умолчанию — сам диалог. */
  readonly autofocusRef?: RefObject<HTMLElement | null> | undefined;
}

/**
 * @param rootRef корневой элемент диалога (role="dialog"), для ловушки Tab
 *                и начального фокуса
 */
export function useModal(rootRef: RefObject<HTMLElement | null>, options: ModalOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // T-40: кнопку-открывалку запоминаем ДО монтирования (в render-фазе): атрибут
  // autoFocus дочерних элементов срабатывает раньше эффектов, и к моменту
  // useEffect фокус уже внутри диалога.
  const openerRef = useRef<HTMLElement | null | undefined>(undefined);
  if (openerRef.current === undefined) {
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }

  useEffect(() => {
    const token = {};
    openModals.push(token);
    const root = rootRef.current;
    const preferred = optionsRef.current.autofocusRef?.current ?? null;
    if (preferred !== null) {
      preferred.focus();
    } else if (root !== null) {
      root.focus();
    }

    const onKey = (e: KeyboardEvent): void => {
      if (openModals[openModals.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        optionsRef.current.onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const dlg = rootRef.current;
      if (dlg === null) return;
      const nodes = dlg.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      // Фокус мог оказаться вне диалога (например, на <body> после перерисовки):
      // Tab возвращает его внутрь, а не уводит на страницу под диалогом.
      const inside = active !== null && dlg.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first || active === dlg) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('keydown', onKey);
      const i = openModals.indexOf(token);
      if (i >= 0) openModals.splice(i, 1);
      // Возврат фокуса на кнопку-открывалку (прототип closeDlg).
      const opener = openerRef.current;
      if (opener?.isConnected === true) opener.focus();
    };
  }, [rootRef]);
}
