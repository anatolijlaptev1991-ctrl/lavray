// SPDX-License-Identifier: GPL-3.0-only

// jsonText.test.ts — checkJsonObject: пусто, объект, не-объект, синтаксис с позицией, предел размера.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkJsonObject, MAX_CUSTOM_JSON_BYTES } from './jsonText';

const utf8 = (s: string): number => new TextEncoder().encode(s).length;
/** {"a":"…"} — каркас 8 байт плюс содержимое строки. */
const wrap = (s: string): string => `{"a":"${s}"}`;
const FRAME = 8;

describe('checkJsonObject', () => {
  it('пустая и пробельная строки допустимы — custom-полей нет', () => {
    expect(checkJsonObject('')).toEqual({ ok: true });
    expect(checkJsonObject(' \n\t ')).toEqual({ ok: true });
  });

  it('объект, в том числе пустой, допустим', () => {
    expect(checkJsonObject('{}')).toEqual({ ok: true });
    expect(checkJsonObject('{"dns": {"servers": []}}')).toEqual({ ok: true });
  });

  it.each(['[1,2]', '"text"', '42', 'true', 'null'])('%s — не объект', (text) => {
    expect(checkJsonObject(text)).toEqual({ ok: false, code: 'not_object' });
  });

  it('синтаксическая ошибка: код syntax и позиция строки/столбца (V8: «at position N»)', () => {
    expect(checkJsonObject('{ bad json')).toEqual({ ok: false, code: 'syntax', line: 1, column: 3 });
    expect(checkJsonObject('{"a":1,\n "b":2,\n}')).toEqual({ ok: false, code: 'syntax', line: 3, column: 1 });
  });

  it('лишнее после объекта — syntax; позиция на второй строке', () => {
    expect(checkJsonObject('{"a":1}\n{"b":2}')).toEqual({ ok: false, code: 'syntax', line: 2, column: 1 });
  });

  describe('формулировки движков (JSON.parse подменён: текст ошибки зависит от версии)', () => {
    const failWith = (message: string): void => {
      vi.spyOn(JSON, 'parse').mockImplementation(() => {
        throw new SyntaxError(message);
      });
    };
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('старый V8 — только «at position N»: строка и столбец считаются по тексту', () => {
      failWith('Unexpected token b in JSON at position 11');
      expect(checkJsonObject('{"a": 1,\n  bad}')).toEqual({ ok: false, code: 'syntax', line: 2, column: 3 });
    });

    it('Firefox — «at line L column C of the JSON data»', () => {
      failWith("JSON.parse: expected property name or '}' at line 3 column 5 of the JSON data");
      expect(checkJsonObject('{')).toEqual({ ok: false, code: 'syntax', line: 3, column: 5 });
    });

    it('Safari и V8 с цитатой документа — позиции нет: syntax без line/column', () => {
      failWith("JSON Parse error: Expected '}'");
      expect(checkJsonObject('{')).toEqual({ ok: false, code: 'syntax' });
      failWith('Unexpected token \'}\', ..."1,\n  "b": }\n" is not valid JSON');
      expect(checkJsonObject('{')).toEqual({ ok: false, code: 'syntax' });
    });

    it('цитата из самого JSON не принимается за позицию', () => {
      failWith('Unexpected token \'x\', "{"a":"in JSON at position 5 (line 1 column 6)"}" is not valid JSON');
      expect(checkJsonObject('{')).toEqual({ ok: false, code: 'syntax' });
    });
  });

  it('ровно maxBytes — допустимо, на байт больше — too_large', () => {
    const atLimit = wrap('x'.repeat(100 - FRAME));
    expect(utf8(atLimit)).toBe(100);
    expect(checkJsonObject(atLimit, 100)).toEqual({ ok: true });
    expect(checkJsonObject(wrap('x'.repeat(100 - FRAME + 1)), 100)).toEqual({ ok: false, code: 'too_large' });
  });

  it('размер считается в байтах UTF-8, а не в символах', () => {
    // «я» — 2 байта, «€» — 3, «😀» — 4 (суррогатная пара — один 4-байтовый символ)
    for (const [ch, bytes] of [['я', 2], ['€', 3], ['😀', 4]] as const) {
      const text = wrap(ch.repeat(10));
      const size = FRAME + 10 * bytes;
      expect(utf8(text)).toBe(size);
      expect(checkJsonObject(text, size)).toEqual({ ok: true });
      expect(checkJsonObject(text, size - 1)).toEqual({ ok: false, code: 'too_large' });
    }
  });

  it('по умолчанию предел — 256 КиБ', () => {
    expect(MAX_CUSTOM_JSON_BYTES).toBe(262144);
    expect(checkJsonObject(wrap('x'.repeat(MAX_CUSTOM_JSON_BYTES - FRAME)))).toEqual({ ok: true });
    expect(checkJsonObject(wrap('x'.repeat(MAX_CUSTOM_JSON_BYTES - FRAME + 1)))).toEqual({
      ok: false,
      code: 'too_large',
    });
  });
});
