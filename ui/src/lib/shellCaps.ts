// SPDX-License-Identifier: GPL-3.0-only

// shellCaps.ts — возможности оболочки: одно место, откуда экраны узнают, что
// умеет эта ОС (снимок экрана, самообновление, глобальные клавиши, трей, способ
// выдачи прав для TUN). Оболочка отвечает командой `shell_capabilities`; её
// грузит main.tsx один раз при старте (`loadShellCaps`), дальше значения
// читаются синхронно. До ответа, а также со старой оболочкой без команды,
// действуют запасные значения: в Tauri на Windows — как до появления команды,
// в Tauri на Linux — по User-Agent, в вебе всё выключено.
import { detectOS, type HostOS } from '../platform/hostOs';

export type CapsOS = 'windows' | 'linux' | 'macos' | 'web';

export interface ShellCaps {
  readonly os: CapsOS;
  readonly sessionType: 'wayland' | 'x11' | '';
  readonly packaging: 'installed' | 'portable' | 'deb' | 'appimage' | 'other';
  /** `admin` — права получает процесс (UAC); `grant` — права выдаются бинарю ядра (Linux). */
  readonly tunAccess: 'admin' | 'grant';
  readonly screenCapture: boolean;
  readonly selfUpdate: boolean;
  readonly globalHotkeys: boolean;
  readonly trayAvailable: boolean;
}

const WEB: ShellCaps = {
  os: 'web',
  sessionType: '',
  packaging: 'other',
  tunAccess: 'admin',
  screenCapture: false,
  selfUpdate: false,
  globalHotkeys: false,
  trayAvailable: false,
};
const WINDOWS: ShellCaps = {
  os: 'windows',
  sessionType: '',
  packaging: 'installed',
  tunAccess: 'admin',
  screenCapture: true,
  selfUpdate: true,
  globalHotkeys: true,
  trayAvailable: true,
};
const LINUX: ShellCaps = {
  ...WINDOWS,
  os: 'linux',
  packaging: 'other',
  tunAccess: 'grant',
  screenCapture: false,
  selfUpdate: false,
};
const MACOS: ShellCaps = { ...WINDOWS, os: 'macos' };

const inShell = (): boolean => (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;

/** Запасные значения до ответа оболочки (объекты постоянные: снимок для useSyncExternalStore стабилен). */
function fallback(): ShellCaps {
  if (!inShell()) return WEB;
  const os: HostOS = detectOS(window);
  return os === 'linux' ? LINUX : os === 'macos' ? MACOS : WINDOWS;
}

let loaded: ShellCaps | null = null;
const listeners = new Set<() => void>();

/** Текущие возможности: ответ оболочки либо запасные значения. */
export function getShellCaps(): ShellCaps {
  return loaded ?? fallback();
}

export function subscribeShellCaps(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallbackValue: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallbackValue;
}

/** Ответ команды → возможности; поля неожиданного вида берутся из запасных значений. */
export function parseShellCaps(raw: unknown, base: ShellCaps): ShellCaps | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const flag = (name: string, dflt: boolean): boolean => (typeof r[name] === 'boolean' ? r[name] : dflt);
  return {
    os: pick(r.os, ['windows', 'linux', 'macos'], base.os === 'web' ? 'windows' : base.os),
    sessionType: pick(r.sessionType, ['wayland', 'x11', ''], ''),
    packaging: pick(r.packaging, ['installed', 'portable', 'deb', 'appimage', 'other'], base.packaging),
    tunAccess: pick(r.tunAccess, ['admin', 'grant'], base.tunAccess),
    screenCapture: flag('screenCapture', base.screenCapture),
    selfUpdate: flag('selfUpdate', base.selfUpdate),
    globalHotkeys: flag('globalHotkeys', base.globalHotkeys),
    trayAvailable: flag('trayAvailable', base.trayAvailable),
  };
}

/**
 * Загрузить возможности один раз при старте. Вне оболочки — ничего; команды нет
 * (старая оболочка) или она ответила ошибкой — остаются запасные значения.
 */
export async function loadShellCaps(): Promise<void> {
  if (!inShell()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const parsed = parseShellCaps(await invoke<unknown>('shell_capabilities'), fallback());
    if (parsed === null) return;
    loaded = parsed;
    listeners.forEach((listener) => {
      listener();
    });
  } catch {
    /* команды нет в этой оболочке: запасные значения */
  }
}

/** Сколько первый рендер ждёт ответ `shell_capabilities`. */
export const SHELL_CAPS_WAIT_MS = 300;

/**
 * Загрузка с пределом ожидания: зависшая команда не задерживает первый кадр.
 * По истечении предела рендер идёт с запасными значениями, а поздний ответ
 * доходит до экранов через подписку (`subscribeShellCaps`).
 */
export async function loadShellCapsWithin(ms: number = SHELL_CAPS_WAIT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  await Promise.race([loadShellCaps(), limit]);
  clearTimeout(timer);
}

/** Для тестов: забыть загруженное. */
export function resetShellCaps(): void {
  loaded = null;
}
