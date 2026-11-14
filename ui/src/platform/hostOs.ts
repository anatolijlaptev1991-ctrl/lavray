// SPDX-License-Identifier: GPL-3.0-only

// hostOs.ts — единственное место, где ОС определяется по User-Agent. Ей пользуются
// и адаптер (React-хром, ⌘/Ctrl), и main.tsx (`html[data-os]` для CSS), и запасные
// значения возможностей оболочки (lib/shellCaps.ts), пока она не ответила.

export type HostOS = 'windows' | 'macos' | 'linux' | 'web';

export function detectOS(win: Window): HostOS {
  const ua = win.navigator.userAgent;
  if (ua.includes('Mac')) return 'macos';
  if (ua.includes('Windows')) return 'windows';
  if (ua.includes('Linux') || ua.includes('X11')) return 'linux';
  return 'web';
}
