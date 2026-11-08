// SPDX-License-Identifier: GPL-3.0-only

// importFileGuard.ts — предел размера файла для импорта. Файл целиком уходит в
// ImportContent одним сообщением, а ядро отвергает запрос больше своего лимита
// (api.MaxRequestBytes = 16 МиБ, core/internal/api/limits.go), поэтому слишком
// большой файл не читаем в память вовсе.

/** Мегабайт в пределе — для текста ошибки. */
export const MAX_IMPORT_FILE_MB = 16;
/** Предел размера файла в байтах (совпадает с лимитом сообщения RPC ядра). */
export const MAX_IMPORT_FILE_BYTES = MAX_IMPORT_FILE_MB * 1024 * 1024;

export const isImportFileTooLarge = (file: { readonly size: number }): boolean =>
  file.size > MAX_IMPORT_FILE_BYTES;
