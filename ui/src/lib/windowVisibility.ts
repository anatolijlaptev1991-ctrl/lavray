// SPDX-License-Identifier: GPL-3.0-only

// windowVisibility.ts — единый признак «окно скрыто в трей» для всего интерфейса.
// Скрытое окно никто не видит, поэтому таймеры, потоки и перерисовки на нём
// останавливаются (статус-бар, график, длительность сессии, соединения), а
// опрос статуса для трея, kill switch и системного прокси лишь замедляется.
//
// Источники признака (скрыто, если любой говорит «скрыто»):
//  1. `document.hidden` + `visibilitychange`. Надёжнее всего там, где движок сам
//     видит скрытие окна, но WebKitGTK и WebView2 не обязаны сообщать о
//     `window.hide()` оболочки (и о старте сразу скрытым), поэтому на него одного
//     не полагаемся.
//  2. Окно Tauri: потеря фокуса (`tauri://blur`) — это ещё не скрытие (окно может
//     быть на виду без фокуса), поэтому после неё спрашиваем `isVisible()`. Для
//     вызова нужно разрешение `core:window:allow-is-visible`; без него вызов
//     отклоняется и источник молча молчит. Тот же вопрос задаётся один раз на
//     старте — для запуска сразу в трее, когда фокус никогда не приходил.
//  3. Событие оболочки `window-visibility` (payload: bool «окно видно», false и
//     для свёрнутого): самый точный источник, оболочка шлёт его при каждом
//     hide()/show() и сразу после старта. Первое же событие становится главным:
//     пока оно известно, document.hidden и isVisible() не учитываются (WebKitGTK
//     может ошибаться в обе стороны). Событие, ушедшее до подписки, теряется, тогда
//     действуют источники 1 и 2 до следующего события.
// «Видно» объявляют фокус окна, `visibilitychange` в видимое состояние и любой
// ввод пользователя (скрытое окно ввода не получает): признак не может залипнуть.

/** Событие оболочки: payload — окно видно (true) или скрыто (false). */
export const WINDOW_VISIBILITY_EVENT = "window-visibility";

type Listener = () => void;

const inShell = (): boolean =>
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
  undefined;

const INPUT_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
] as const;

const listeners = new Set<Listener>();
let shellHidden = false;
/** Последнее событие оболочки: окно видно; null — события ещё не было. */
let shellVisible: boolean | null = null;
let announced = false;
/** Номер последнего «свидетельства» от оболочки: устаревший ответ isVisible() отбрасывается. */
let evidence = 0;
let detach: (() => void) | undefined;

/** Окно скрыто? Считается заново при каждом вызове (document.hidden меняется без нашего ведома в тестах). */
export function isWindowHidden(): boolean {
  if (shellVisible !== null) return !shellVisible;
  return (typeof document !== "undefined" && document.hidden) || shellHidden;
}

function announce(): void {
  const now = isWindowHidden();
  if (now === announced) return;
  announced = now;
  [...listeners].forEach((l) => {
    l();
  });
}

function setShellHidden(hidden: boolean): void {
  evidence += 1;
  shellHidden = hidden;
  // «Видно» по косвенным признакам (фокус, ввод, visibilitychange) важнее устаревшего события.
  if (!hidden && shellVisible !== null) shellVisible = true;
  announce();
}

/** Событие `window-visibility` от оболочки. */
function setShellVisible(visible: boolean): void {
  evidence += 1;
  shellVisible = visible;
  shellHidden = false;
  announce();
}

/** Спросить у окна Tauri, видно ли оно; ответ применяется, только если за время вопроса ничего не произошло. */
async function probe(isVisible: () => Promise<boolean>): Promise<void> {
  const mine = ++evidence;
  try {
    const visible: unknown = await isVisible();
    if (
      mine !== evidence ||
      typeof visible !== "boolean" ||
      shellVisible !== null
    )
      return;
    shellHidden = !visible;
    announce();
  } catch {
    /* нет разрешения core:window:allow-is-visible: остаётся document.hidden */
  }
}

/**
 * Текущая видимость от оболочки (команда `window_visible`). Событие при загрузке
 * страницы может уйти раньше, чем интерфейс подпишется, поэтому после подписки
 * значение спрашивается явно. Старая оболочка без команды отвечает ошибкой или
 * не булевым значением — тогда остаются событие, isVisible() и document.hidden.
 */
async function askShell(): Promise<void> {
  const mine = ++evidence;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const visible: unknown = await invoke("window_visible");
    if (mine === evidence && typeof visible === "boolean")
      setShellVisible(visible);
  } catch {
    /* старая оболочка без команды */
  }
}

async function attachShell(
  isCancelled: () => boolean,
): Promise<(() => void) | undefined> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { listen } = await import("@tauri-apps/api/event");
  if (isCancelled()) return undefined;
  const win = getCurrentWindow();
  const ask = (): Promise<void> => probe(() => win.isVisible());
  const stops = await Promise.all([
    win.onFocusChanged(({ payload: focused }) => {
      if (focused) setShellHidden(false);
      else void ask();
    }),
    listen<boolean>(WINDOW_VISIBILITY_EVENT, (e) => {
      if (typeof e.payload === "boolean") setShellVisible(e.payload);
    }),
  ]);
  const release = (): void => {
    stops.forEach((stop) => {
      stop();
    });
  };
  if (isCancelled()) {
    release();
    return undefined;
  }
  // Сначала оболочка (знает и про hide(), и про сворачивание), затем isVisible():
  // он пропускается, если оболочка уже ответила.
  void askShell().finally(() => {
    void ask();
  });
  return release;
}

function attach(): () => void {
  const onVisibility = (): void => {
    if (!document.hidden) setShellHidden(false);
    else announce();
  };
  const onInput = (): void => {
    if (shellHidden || shellVisible === false) setShellHidden(false);
  };
  document.addEventListener("visibilitychange", onVisibility);
  let cancelled = false;
  let releaseShell: (() => void) | undefined;
  if (inShell()) {
    INPUT_EVENTS.forEach((n) => {
      window.addEventListener(n, onInput, { passive: true, capture: true });
    });
    attachShell(() => cancelled)
      .then((release) => {
        releaseShell = release;
      })
      .catch(() => undefined);
  }
  announced = isWindowHidden();
  return (): void => {
    cancelled = true;
    document.removeEventListener("visibilitychange", onVisibility);
    INPUT_EVENTS.forEach((n) => {
      window.removeEventListener(n, onInput, { capture: true });
    });
    releaseShell?.();
    shellHidden = false;
    shellVisible = null;
  };
}

/** Подписка на смену признака; источники подключаются при первом подписчике и отключаются при последнем. */
export function subscribeWindowHidden(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) detach = attach();
  return (): void => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    detach?.();
    detach = undefined;
  };
}
