// SPDX-License-Identifier: GPL-3.0-only

// useQrHotkey.ts — Ctrl/⌘+Q: показать QR-код выбранного сервера. Сочетание
// читается по физической клавише (работает на русской раскладке) и
// игнорируется, пока фокус в поле ввода, как и остальные хоткеи окна.
import { useEffect, useMemo, useRef } from 'react';
import { hotkeyOf, isTypingTarget } from '../lib/hotkeys';
import { detectOS } from '../platform/adapter';

/** onPress вызывается на каждое нажатие; актуальное замыкание берётся через ref. */
export function useQrHotkey(onPress: () => void): void {
  const os = useMemo(() => detectOS(window), []);
  const latest = useRef(onPress);
  latest.current = onPress;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = os === 'macos' ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey || hotkeyOf(e) !== 'q' || isTypingTarget(e.target)) return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey);
    return (): void => {
      window.removeEventListener('keydown', onKey);
    };
  }, [os]);
}
