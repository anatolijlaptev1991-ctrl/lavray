// SPDX-License-Identifier: GPL-3.0-only

// uiJournal.ts — журнал интерфейса: события окна, которые не должны пропадать
// молча (отказ оболочки включить системный прокси и т. п.). Хранит последние
// записи в памяти и дублирует их в консоль WebView.

export type JournalLevel = 'info' | 'warn' | 'error';

export interface JournalEntry {
  readonly ts: number;
  readonly level: JournalLevel;
  readonly message: string;
}

/** Сколько последних записей держим. */
export const JOURNAL_LIMIT = 200;

let entries: readonly JournalEntry[] = [];

export function logUi(level: JournalLevel, message: string): void {
  entries = [...entries, { ts: Date.now(), level, message }].slice(-JOURNAL_LIMIT);
  const line = `[lavray-ui] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

/** Записи по порядку, старые первыми. */
export function recentUiLog(): readonly JournalEntry[] {
  return entries;
}

/** Для тестов. */
export function clearUiLog(): void {
  entries = [];
}
