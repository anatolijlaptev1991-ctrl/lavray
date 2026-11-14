// SPDX-License-Identifier: GPL-3.0-only

// motion.ts — настройка «Анимации» (Настройки → Оформление). Значение пишется на
// `<html data-motion="full|lite|off">`, правила — в effects.css:
//  - full: все эффекты; медленный дрейф лучей фона идёт, только пока пользователь
//    работает с окном (`html[data-input="1"]`), и замирает через MOTION_IDLE_MS без ввода;
//  - lite: только короткие переходы (оттенок фона, статус, диалоги), без каскадов,
//    блика, волны и бесконечных анимаций;
//  - off: без анимаций и переходов (как prefers-reduced-motion).
// Без явного выбора действует «off» при системном prefers-reduced-motion и «full»
// иначе; явный выбор пользователя важнее системного. Хранится в `lavray.motion`
// (общий с повышенным экземпляром ключ, lib/uiState.ts) и применяется сразу.
import type { MessageKey } from './i18n';

export type MotionPreference = 'full' | 'lite' | 'off';
export const MOTIONS: readonly MotionPreference[] = ['full', 'lite', 'off'];

/** Строки для поиска по настройкам (раздел «Оформление»). */
export const MOTION_ROWS: readonly { readonly labelKey: MessageKey }[] = [
  { labelKey: 'set.motion' },
  ...MOTIONS.map((m) => ({ labelKey: `motion.${m}` as MessageKey })),
];

export const MOTION_KEY = 'lavray.motion';
/** Сколько без ввода дрейф фона ещё идёт, потом замирает. */
export const MOTION_IDLE_MS = 20_000;
/** Событие смены настройки: App пере-применяет атрибуты и слежение за вводом. */
export const MOTION_EVENT = 'lavray:motion';

/** Системный prefers-reduced-motion; без matchMedia (старые webview, jsdom) — нет. */
function systemReducesMotion(win: Window): boolean {
  return typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isMotionPreference(v: unknown): v is MotionPreference {
  return v === 'full' || v === 'lite' || v === 'off';
}

/** Явный выбор пользователя; `null` — не выбирал (или хранилище недоступно). */
export function loadMotionChoice(storage: Storage): MotionPreference | null {
  try {
    const v = storage.getItem(MOTION_KEY);
    return isMotionPreference(v) ? v : null;
  } catch {
    return null;
  }
}

/** Действующий режим: явный выбор, иначе по prefers-reduced-motion. */
export function resolveMotion(storage: Storage, win: Window): MotionPreference {
  return loadMotionChoice(storage) ?? (systemReducesMotion(win) ? 'off' : 'full');
}

export function paintMotion(doc: Document, mode: MotionPreference): void {
  doc.documentElement.dataset.motion = mode;
}

/** Запомнить выбор и сообщить приложению (применяется без перезапуска). */
export function chooseMotion(win: Window, mode: MotionPreference): void {
  try {
    win.localStorage.setItem(MOTION_KEY, mode);
  } catch {
    /* хранилище недоступно: режим действует до перезапуска */
  }
  paintMotion(win.document, mode);
  win.dispatchEvent(new Event(MOTION_EVENT));
}

const INPUT_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focus'] as const;

/**
 * `html[data-input="1"]`, пока пользователь вводит (мышь, клавиатура, колесо,
 * фокус) и ещё `idleMs` после последнего ввода. Один таймер: при вводе он не
 * пересоздаётся, а по срабатыванию переармируется на остаток.
 */
export function watchUserInput(win: Window, idleMs: number = MOTION_IDLE_MS): () => void {
  const root = win.document.documentElement;
  let last = Date.now();
  let timer: number | undefined;
  const arm = (ms: number): void => {
    timer = win.setTimeout(check, ms);
  };
  function check(): void {
    const left = idleMs - (Date.now() - last);
    if (left > 0) {
      arm(left);
      return;
    }
    timer = undefined;
    delete root.dataset.input;
  }
  const onInput = (): void => {
    last = Date.now();
    if (timer !== undefined) return;
    root.dataset.input = '1';
    arm(idleMs);
  };
  root.dataset.input = '1';
  arm(idleMs);
  INPUT_EVENTS.forEach((n) => {
    win.addEventListener(n, onInput, { passive: true, capture: true });
  });
  return (): void => {
    INPUT_EVENTS.forEach((n) => {
      win.removeEventListener(n, onInput, { capture: true });
    });
    win.clearTimeout(timer);
    delete root.dataset.input;
  };
}
