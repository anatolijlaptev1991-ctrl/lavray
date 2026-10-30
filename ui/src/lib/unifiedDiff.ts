// SPDX-License-Identifier: GPL-3.0-only

// unifiedDiff.ts — разбор unified diff от ядра (PreviewCustomFields) в типизированные
// строки для DiffView. Формат: «--- before» / «+++ after», заголовки ханков
// «@@ -a,n +b,m @@», строки « »/«-»/«+», «\ No newline at end of file».
// Номера строк берутся из заголовков ханков; «-a +b» без «,n» значит n = 1.

export type DiffLineKind = 'file' | 'hunk' | 'add' | 'del' | 'ctx' | 'meta';

export interface DiffLine {
  readonly kind: DiffLineKind;
  /** add/del/ctx — содержимое без ведущего маркера; file/hunk/meta — строка целиком. */
  readonly text: string;
  /** Номер в старом файле: у del и ctx. */
  readonly oldNo?: number;
  /** Номер в новом файле: у add и ctx. */
  readonly newNo?: number;
}

interface Cursor {
  oldNo: number;
  newNo: number;
  oldLeft: number;
  newLeft: number;
  /** Ханк уже встречался: «+»/«-»/« » вне счётчиков всё равно строки тела. */
  seen: boolean;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
/** Ведущий символ строки «\ No newline at end of file» (один обратный слэш). */
const NO_NEWLINE_MARK = '\\';

/** Число строк ханка: пропущенное «,n» — одна строка (так пишет git). */
const count = (raw: string | undefined): number => (raw === undefined ? 1 : Number(raw));

function parseHunk(line: string, cur: Cursor): DiffLine {
  const m = HUNK.exec(line);
  if (m === null) return { kind: 'meta', text: line };
  cur.oldNo = Number(m[1]);
  cur.newNo = Number(m[3]);
  cur.oldLeft = count(m[2]);
  cur.newLeft = count(m[4]);
  cur.seen = true;
  return { kind: 'hunk', text: line };
}

/** Строка тела ханка по ведущему маркеру; null — это не строка тела. */
function parseBody(line: string, cur: Cursor): DiffLine | null {
  const marker = line.slice(0, 1);
  const text = line.slice(1);
  if (marker === '+') {
    cur.newLeft = Math.max(0, cur.newLeft - 1);
    return { kind: 'add', text, newNo: cur.newNo++ };
  }
  if (marker === '-') {
    cur.oldLeft = Math.max(0, cur.oldLeft - 1);
    return { kind: 'del', text, oldNo: cur.oldNo++ };
  }
  if (marker === ' ' || line === '') {
    cur.oldLeft = Math.max(0, cur.oldLeft - 1);
    cur.newLeft = Math.max(0, cur.newLeft - 1);
    return { kind: 'ctx', text, oldNo: cur.oldNo++, newNo: cur.newNo++ };
  }
  return null;
}

function parseLine(line: string, cur: Cursor): DiffLine {
  if (line.startsWith('@@')) return parseHunk(line, cur);
  if (line.startsWith(NO_NEWLINE_MARK)) return { kind: 'meta', text: line };
  const inHunk = cur.oldLeft > 0 || cur.newLeft > 0;
  // Пока счётчики ханка не исчерпаны, «--- x» — удалённая строка «-- x», а не заголовок файла.
  if (!inHunk && (line.startsWith('--- ') || line.startsWith('+++ '))) {
    return { kind: 'file', text: line };
  }
  // Пустая строка вне ханка — не контекст (внутри ханка её оставляют редакторы, срезавшие пробел).
  if (inHunk || (cur.seen && line !== '')) return parseBody(line, cur) ?? { kind: 'meta', text: line };
  return { kind: 'meta', text: line };
}

/** Разбирает unified diff; пустой текст даёт пустой список, CRLF допускается. */
export function parseUnifiedDiff(text: string): readonly DiffLine[] {
  if (text.trim() === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop(); // завершающий перевод строки
  const cur: Cursor = { oldNo: 0, newNo: 0, oldLeft: 0, newLeft: 0, seen: false };
  return lines.map((line) => parseLine(line, cur));
}
