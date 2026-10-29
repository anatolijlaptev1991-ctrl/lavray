// SPDX-License-Identifier: GPL-3.0-only

// external.ts — внешние ссылки и перетаскивание файлов в окне Tauri (T-58).
// WebView2 молча гасит window.open, а перетаскивание файла отдаёт
// оболочке; здесь UI открывает ссылки через плагин opener оболочки (scope
// в capabilities/default.json — только https и http) и не даёт случайно
// брошенному файлу увести окно на file://.

/** Адрес, который можно открыть вовне: абсолютный http(s) без пробелов и управляющих символов. */
export function isExternalUrl(raw: string): boolean {
  // eslint-disable-next-line no-control-regex -- управляющие символы в адресе недопустимы
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return false;
  try {
    const { protocol } = new URL(raw);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Открыть ссылку в системном браузере. В окне Tauri — командой плагина
 * opener, в веб-панели — новой вкладкой. Возвращает `false`, если адрес не
 * http(s): `javascript:`, `file:`, `ms-msdt:` и прочие схемы не открываются.
 */
export async function openExternal(raw: string): Promise<boolean> {
  if (!isExternalUrl(raw)) return false;
  if ((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('plugin:opener|open_url', { url: raw });
  } else {
    window.open(raw, '_blank', 'noopener,noreferrer');
  }
  return true;
}

/**
 * Файл, брошенный мимо зоны импорта, не должен открыться в окне вместо
 * интерфейса: с `dragDropEnabled: false` события перетаскивания приходят
 * странице, а действие по умолчанию — переход на файл. Зона импорта сама
 * принимает drop; здесь гасится только действие по умолчанию. Возвращает
 * функцию снятия обработчиков.
 */
export function installDropGuard(target: Window = window): () => void {
  const guard = (event: DragEvent): void => {
    if (event.dataTransfer?.types.includes('Files') === true) event.preventDefault();
  };
  target.addEventListener('dragover', guard);
  target.addEventListener('drop', guard);
  return (): void => {
    target.removeEventListener('dragover', guard);
    target.removeEventListener('drop', guard);
  };
}
