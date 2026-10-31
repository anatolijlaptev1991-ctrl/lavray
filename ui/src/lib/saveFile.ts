// SPDX-License-Identifier: GPL-3.0-only

// saveFile.ts — «Сохранить как» (T-82). В окне приложения путь выбирает
// пользователь в системном диалоге (команда оболочки `file_save`: данные —
// сырое тело, имя и расширение — заголовки); страница предлагает только имя.
// В веб-панели — обычная загрузка браузера.

export type SaveExt = 'txt' | 'log' | 'json' | 'lavbk';
export type SaveResult = 'saved' | 'cancelled';

const inShell = (): boolean => (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? new TextEncoder().encode(data) : data;
}

function browserDownload(name: string, ext: SaveExt, bytes: Uint8Array): SaveResult {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: ext === 'json' ? 'application/json' : 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
  return 'saved';
}

/** Сохранить файл; отказ оболочки — `Error(код)`: `bad_name`, `too_large`, `io:<вид>`… */
export async function saveFile(name: string, ext: SaveExt, data: Uint8Array | string): Promise<SaveResult> {
  const bytes = toBytes(data);
  if (!inShell()) return browserDownload(name, ext, bytes);
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    const saved = await invoke<unknown>('file_save', bytes, {
      headers: { 'x-lavray-name': encodeURIComponent(name), 'x-lavray-ext': ext },
    });
    return saved === true ? 'saved' : 'cancelled';
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : e instanceof Error ? e.message : 'failed');
  }
}
