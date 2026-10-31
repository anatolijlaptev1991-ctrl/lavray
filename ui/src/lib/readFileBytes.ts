// SPDX-License-Identifier: GPL-3.0-only

/** Содержимое файла из `<input type="file">` как байты (FileReader есть и в браузере, и в jsdom). */
export function readFileBytes(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    };
    reader.onerror = (): void => {
      reject(reader.error ?? new Error('read failed'));
    };
    reader.readAsArrayBuffer(file);
  });
}
