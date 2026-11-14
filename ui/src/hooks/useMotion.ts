// SPDX-License-Identifier: GPL-3.0-only

// useMotion.ts — применяет настройку «Анимации» к `<html>` (lib/motion.ts):
// `data-motion` всегда, `data-input` (слежение за вводом) — только в режиме
// «Полные». Следит за сменой выбора и за системным prefers-reduced-motion.
import { useEffect } from 'react';
import { MOTION_EVENT, paintMotion, resolveMotion, watchUserInput } from '../lib/motion';

export function useMotion(): void {
  useEffect(() => {
    let stopInput: (() => void) | undefined;
    const apply = (): void => {
      const mode = resolveMotion(window.localStorage, window);
      paintMotion(document, mode);
      stopInput?.();
      stopInput = mode === 'full' ? watchUserInput(window) : undefined;
    };
    apply();
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    window.addEventListener(MOTION_EVENT, apply);
    mql?.addEventListener('change', apply);
    return (): void => {
      window.removeEventListener(MOTION_EVENT, apply);
      mql?.removeEventListener('change', apply);
      stopInput?.();
      delete document.documentElement.dataset.motion;
    };
  }, []);
}
