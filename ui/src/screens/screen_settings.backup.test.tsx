// T-13: «Резервная копия» — это открытый JSON одних настроек (без серверов и
// подписок). Подписи не должны обещать шифрование и «все данные», а пароль
// локального прокси не должен попадать в файл.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { LANGUAGES, setLanguage, t, type Language } from '../lib/i18n';
import { flush, mountSettings, type SettingsHarness } from '../test-utils/settingsKit';

/** jsdom-Blob не умеет text(): читаем через FileReader. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = (): void => {
      reject(new Error('FileReader: ошибка чтения'));
    };
    reader.readAsText(blob);
  });
}

describe('T-13: резервная копия не лжёт и не выносит пароль', () => {
  let current: SettingsHarness | undefined;
  let exported: Blob | undefined;

  beforeEach(() => {
    setLanguage('en');
    exported = undefined;
    // jsdom не реализует URL.createObjectURL: перехватываем Blob экспорта.
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource): string => {
      exported = blob as Blob;
      return 'blob:lavray-test';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    current?.unmount();
    current = undefined;
    vi.restoreAllMocks();
  });

  async function exportedJson(): Promise<{ text: string; data: Record<string, unknown> }> {
    current = await mountSettings({
      'inbound.port': 2080,
      'inbound.auth.user': 'neko',
      'inbound.auth.pass': 'hunter2-secret',
      'ui.max_log_lines': 500,
    });
    const button = current.container.querySelector<HTMLElement>('[data-sec="backup"] .set-row .btn-sec');
    expect(button, 'кнопка экспорта в карточке «Резервная копия»').not.toBeNull();
    await act(async () => {
      button!.click();
      await Promise.resolve();
    });
    await flush();
    expect(exported, 'экспорт должен создать файл').toBeDefined();
    const text = await readBlob(exported!);
    return { text, data: JSON.parse(text) as Record<string, unknown> };
  }

  it('файл экспорта содержит настройки, но не пароль локального прокси', async () => {
    const { text, data } = await exportedJson();
    expect(data['inbound.port']).toBe(2080);
    expect(data['inbound.auth.user']).toBe('neko');
    expect(data['ui.max_log_lines']).toBe(500);
    expect(data).not.toHaveProperty('inbound.auth.pass');
    expect(text).not.toContain('hunter2-secret');
  });

  it('на экране нет обещаний «все данные» и «зашифрован», есть пометка про состав файла', async () => {
    current = await mountSettings();
    const card = current.container.querySelector('[data-sec="backup"]')?.textContent ?? '';
    expect(card).not.toMatch(/all data/i);
    expect(card).toMatch(/without servers and subscriptions/i);
    expect(card).toMatch(/unencrypted/i);
    expect(card).toMatch(/password .* not saved/i);
  });

  it('во всех пяти языках подписи экспорта честные', () => {
    const noAllData: Record<Language, RegExp> = {
      ru: /всех данных/i,
      en: /all data/i,
      zh: /全部数据/,
      es: /todos los datos/i,
      de: /alle Daten/i,
    };
    // «зашифрован» допустимо только с отрицанием (не/un/未/sin/Un).
    const claimsEncryption: Record<Language, RegExp> = {
      ru: /(?<!не )зашифрован/i,
      en: /(?<!un)encrypted/i,
      zh: /(?<!未)加密/,
      es: /cifrado/i,
      de: /(?<!un)verschlüsselt/i,
    };
    for (const lang of LANGUAGES) {
      expect(t('bk.export', lang), `bk.export (${lang})`).not.toMatch(noAllData[lang]);
      expect(t('bk.hint', lang), `bk.hint (${lang})`).not.toMatch(claimsEncryption[lang]);
      expect(t('bk.hint', lang), `bk.hint (${lang})`).toContain('JSON');
      expect(t('bk.exportBtn', lang), `bk.exportBtn (${lang})`).not.toBe('bk.exportBtn');
      expect(t('bk.restoreD', lang), `bk.restoreD (${lang})`).not.toBe('bk.restoreD');
    }
  });
});
