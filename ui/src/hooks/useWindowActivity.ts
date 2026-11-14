// SPDX-License-Identifier: GPL-3.0-only

// useWindowActivity.ts — `html[data-active="0"]`, пока окно скрыто или без фокуса.
// CSS (effects.css) ставит на паузу декоративный фон и ореол кнопки по этому
// атрибуту: свёрнутый VPN-клиент не должен греть процессор ради украшений.
// `html[data-hidden="1"]` — окно скрыто в трей (lib/windowVisibility.ts): тогда
// на паузе вообще все анимации, в том числе бесконечные индикаторы.
import { useEffect } from 'react';
import { isWindowHidden, subscribeWindowHidden } from '../lib/windowVisibility';

export function isWindowActive(doc: Document): boolean {
  return doc.visibilityState !== 'hidden' && doc.hasFocus();
}

export function useWindowActivity(): void {
  useEffect(() => {
    const apply = (): void => {
      document.documentElement.dataset.active = isWindowActive(document) ? '1' : '0';
    };
    apply();
    document.addEventListener('visibilitychange', apply);
    window.addEventListener('blur', apply);
    window.addEventListener('focus', apply);
    const applyHidden = (): void => {
      if (isWindowHidden()) document.documentElement.dataset.hidden = '1';
      else delete document.documentElement.dataset.hidden;
      apply();
    };
    applyHidden();
    const stopHidden = subscribeWindowHidden(applyHidden);
    return (): void => {
      stopHidden();
      delete document.documentElement.dataset.hidden;
      document.removeEventListener('visibilitychange', apply);
      window.removeEventListener('blur', apply);
      window.removeEventListener('focus', apply);
      delete document.documentElement.dataset.active;
    };
  }, []);
}
