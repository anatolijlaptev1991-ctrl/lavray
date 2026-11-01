// SPDX-License-Identifier: GPL-3.0-only

// noPlaintextExport.test.ts — T-83: открытого экспорта настроек больше нет.
// Раньше «Экспорт» писал JSON таблицы settings без шифрования и без серверов
// (T-13 убрал ложь в подписях, T-83 заменил функцию настоящей копией). Проверка
// статическая: она ловит возврат файла-экспорта в любом экране.
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}', '!../../gen/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('T-83: открытый экспорт настроек удалён', () => {
  it('no_plaintext_export_remains', () => {
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThan(50);
    // модуль открытого экспорта удалён
    expect(files.filter((f) => f.endsWith('/lib/backup.ts'))).toEqual([]);
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      if (/withoutSecrets|isSecretSettingKey|isAccessSettingKey/.test(text)) offenders.push(`${file}: фильтр секретов экспорта`);
      // Blob с JSON.stringify(...) и расширением .json — признак выгрузки настроек
      if (/new Blob\(\s*\[\s*JSON\.stringify/.test(text)) offenders.push(`${file}: Blob из JSON.stringify`);
      if (/lavray-settings-.*\.json/.test(text)) offenders.push(`${file}: имя файла lavray-settings-*.json`);
    }
    expect(offenders).toEqual([]);
  });

  it('экран настроек подключает только диалоги зашифрованной копии', () => {
    const screen = Object.entries(sources).find(([f]) => f.endsWith('/screens/screen_settings.tsx'))?.[1] ?? '';
    expect(screen).toContain('BackupRows');
    expect(screen).not.toMatch(/type="file"/);
    expect(screen).not.toMatch(/application\/json/);
  });
});
