// SPDX-License-Identifier: GPL-3.0-only

// jsonText.ts — проверка текста custom-JSON до отправки в ядро (T-08B): не больше
// 256 КиБ в UTF-8, синтаксис, верхний уровень — объект. Ядро проверяет то же
// самое (INVALID_ARGUMENT), а клиент показывает причину с позицией сразу в поле.

/** Предел размера custom-JSON в байтах UTF-8 (как в ядре). */
export const MAX_CUSTOM_JSON_BYTES = 256 * 1024;

export type JsonCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'too_large' | 'syntax' | 'not_object';
      /** 1-based; только для syntax и только если позицию удалось определить. */
      readonly line?: number;
      readonly column?: number;
    };

/** Размер строки в байтах UTF-8 без выделения буфера (как TextEncoder: одиночный суррогат — 3 байта). */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** Смещение в тексте → строка и столбец (с 1). */
function fromOffset(text: string, offset: number): { line: number; column: number } {
  const head = text.slice(0, offset);
  const lastBreak = head.lastIndexOf('\n');
  const line = head.split('\n').length;
  return { line, column: offset - lastBreak };
}

// V8 (WebView2, Node): «… in/after JSON at position N», новее — с «(line L column C)» в конце.
const V8_POSITION = / JSON at position (\d+)(?: \(line \d+ column \d+\))?$/;
// Firefox: «… at line L column C of the JSON data». Привязка к концу сообщения не даёт
// принять за позицию кусок самого JSON, который V8 цитирует в тексте ошибки.
const GECKO_POSITION = / at line (\d+) column (\d+) of the JSON data$/;

/** Позиция из текста ошибки JSON.parse; пусто, если движок её не сообщает (Safari, обрезанные сообщения). */
function locate(message: string, text: string): { line?: number; column?: number } {
  const v8 = V8_POSITION.exec(message);
  if (v8 !== null) return fromOffset(text, Number(v8[1]));
  const gecko = GECKO_POSITION.exec(message);
  return gecko === null ? {} : { line: Number(gecko[1]), column: Number(gecko[2]) };
}

/** Пустой или пробельный текст допустим: это «custom-поля не заданы». */
export function checkJsonObject(text: string, maxBytes: number = MAX_CUSTOM_JSON_BYTES): JsonCheck {
  if (text.trim() === '') return { ok: true };
  if (utf8Length(text) > maxBytes) return { ok: false, code: 'too_large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, code: 'syntax', ...locate(e instanceof Error ? e.message : '', text) };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: 'not_object' };
  }
  return { ok: true };
}
