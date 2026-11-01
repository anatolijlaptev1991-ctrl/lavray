// SPDX-License-Identifier: GPL-3.0-only

// readFileText.ts — текст файла, выбранного в <input type="file"> (импорт набора).
// FileReader, а не File.text(): работает и в jsdom, и в старых WebView.

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => { resolve(typeof reader.result === 'string' ? reader.result : ''); };
    reader.onerror = (): void => { reject(reader.error ?? new Error('read failed')); };
    reader.readAsText(file);
  });
}
