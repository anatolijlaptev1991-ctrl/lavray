// SPDX-License-Identifier: GPL-3.0-only

// useWindowActivity.ts — `html[data-active="0"]`, пока окно скрыто или без фокуса.
// CSS (effects.css) ставит на паузу декоративный фон и ореол кнопки по этому
// атрибуту: свёрнутый VPN-клиент не должен греть процессор ради украшений.
import { useEffect } from 'react';

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
    return (): void => {
      document.removeEventListener('visibilitychange', apply);
      window.removeEventListener('blur', apply);
      window.removeEventListener('focus', apply);
      delete document.documentElement.dataset.active;
    };
  }, []);
}
