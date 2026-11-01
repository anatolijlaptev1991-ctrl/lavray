// SPDX-License-Identifier: GPL-3.0-only

// uiState.ts — общие настройки UI между профилями WebView (T-81, ревью). У
// повышенного экземпляра приложения свой профиль WebView, а язык, тема, режимы,
// выбор сервера и признак пройденного онбординга у обоих должны быть одни. Источник
// истины — файл `ui-state.json` в каталоге данных (команды оболочки
// `ui_state_load` / `ui_state_set`), `localStorage` — кэш:
//  - до первого рендера значения из файла применяются к `localStorage`;
//  - каждое изменение отслеживаемого ключа сразу уходит в файл (по порядку).
// Список ключей явный и совпадает с `ALLOWED_KEYS` оболочки (сверяется тестом
// оболочки); токенов и секретов в нём нет.

/** Ключи `localStorage`, общие для обычного и повышенного экземпляров. */
export const UI_STATE_KEYS: readonly string[] = [
  'lavray.lang',
  'lavray.theme',
  'lavray.accent',
  'lavray.modes',
  'lavray.server',
  'lavray.onboarded',
  // T-82: настройки оболочки (lib/shellPrefs.ts) — оболочка читает их до создания окна.
  'lavray.closeToTray',
  'lavray.startMinimized',
  'lavray.notify',
  'lavray.hotkeyConnect',
  // Хвосты B: копия настройки ядра connect.kill_switch_proxy для оболочки (lib/killSwitch.ts).
  'lavray.killSwitchProxy',
];

function inShell(): boolean {
  return (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

const tracked = (key: string): boolean => UI_STATE_KEYS.includes(key);

// Записи в файл идут по очереди: два быстрых изменения одного ключа не должны
// поменяться местами. Сбой записи очередь не останавливает.
let queue: Promise<void> = Promise.resolve();
// Пока значения из файла применяются к хранилищу, обратно в файл они не пишутся.
let applying = false;

function enqueue(key: string, value: string | null): void {
  queue = queue
    .then(async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('ui_state_set', { key, value });
    })
    .catch(() => undefined);
}

/** Дождаться записи всего, что уже поставлено в очередь. */
export function flushUiState(): Promise<void> {
  return queue;
}

/**
 * Записать в файл текущие значения всех отслеживаемых ключей и дождаться записи.
 * Нужно перед перезапуском от администратора: новый экземпляр прочитает файл.
 */
export async function saveUiStateNow(storage: Storage): Promise<void> {
  if (!inShell()) return;
  for (const key of UI_STATE_KEYS) {
    const value = storage.getItem(key);
    if (value !== null) enqueue(key, value);
  }
  await queue;
}

/** Ответ `ui_state_load`: только строковые значения отслеживаемых ключей. */
function parseEntries(answer: unknown): Record<string, string> {
  const entries: Record<string, string> = {};
  if (typeof answer !== 'object' || answer === null) return entries;
  const raw = (answer as { entries?: unknown }).entries;
  if (typeof raw !== 'object' || raw === null) return entries;
  for (const [key, value] of Object.entries(raw)) {
    if (tracked(key) && typeof value === 'string') entries[key] = value;
  }
  return entries;
}

/**
 * Применить сохранённые настройки к `storage` до первого рендера: значение из
 * файла важнее кэша. Отслеживаемые ключи, которых в файле нет, а в кэше есть
 * (первый запуск после обновления, испорченный файл), переносятся в файл. Вне
 * оболочки и при сбое команды окно остаётся со своим `localStorage`.
 */
export async function hydrateUiState(storage: Storage): Promise<void> {
  if (!inShell()) return;
  let entries: Record<string, string>;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    entries = parseEntries(await invoke<unknown>('ui_state_load'));
  } catch {
    return;
  }
  applying = true;
  try {
    for (const [key, value] of Object.entries(entries)) storage.setItem(key, value);
  } finally {
    applying = false;
  }
  for (const key of UI_STATE_KEYS) {
    const cached = storage.getItem(key);
    if (!(key in entries) && cached !== null) enqueue(key, cached);
  }
}

/**
 * Следить за записями в `storage`: любое изменение отслеживаемого ключа уходит
 * в файл. Перехват стоит на прототипе `Storage` (присваивание свойства объекту
 * хранилища создало бы запись), чужие хранилища и прочие ключи не затрагиваются.
 * Возвращает функцию, снимающую перехват.
 */
export function installUiStateSync(storage: Storage): () => void {
  const proto = Object.getPrototypeOf(storage) as Storage;
  /* eslint-disable @typescript-eslint/unbound-method -- методы вызываются через call(this) */
  const originalSet = proto.setItem;
  const originalRemove = proto.removeItem;
  const originalClear = proto.clear;
  /* eslint-enable @typescript-eslint/unbound-method */

  proto.setItem = function (this: Storage, key: string, value: string): void {
    originalSet.call(this, key, value);
    if (this === storage && !applying && inShell() && tracked(key)) enqueue(key, value);
  };
  proto.removeItem = function (this: Storage, key: string): void {
    originalRemove.call(this, key);
    if (this === storage && !applying && inShell() && tracked(key)) enqueue(key, null);
  };
  proto.clear = function (this: Storage): void {
    const present = this === storage ? UI_STATE_KEYS.filter((key) => this.getItem(key) !== null) : [];
    originalClear.call(this);
    if (inShell()) for (const key of present) enqueue(key, null);
  };
  return (): void => {
    proto.setItem = originalSet;
    proto.removeItem = originalRemove;
    proto.clear = originalClear;
  };
}
