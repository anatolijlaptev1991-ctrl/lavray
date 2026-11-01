// SPDX-License-Identifier: GPL-3.0-only

// BackupRows.test.tsx — строки «Резервная копия» в «Настройках» (T-83): две
// кнопки открывают диалоги создания и восстановления; подписи не обещают ничего
// лишнего и переведены на все языки.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LANGUAGES, setLanguage, t } from '../../lib/i18n';
import { mountSettings, type SettingsHarness } from '../../test-utils/settingsKit';

const BK_KEYS = [
  'bk.export', 'bk.exportBtn', 'bk.hint', 'bk.restore', 'bk.restoreD', 'bk.restoreTitle', 'bk.exportTitle',
  'bk.pwHint', 'bk.pwShort', 'bk.pwLong', 'bk.ack', 'bk.file', 'bk.pwRestore', 'bk.check', 'bk.replaceWarn',
  'bk.replaceBtn', 'bk.confirmTitle', 'bk.confirmText', 'bk.confirmOk', 'bk.done', 'bk.reload',
  'bk.err.wrongPassword', 'bk.err.tampered', 'bk.err.newer', 'bk.err.tooLarge', 'bk.err.busy', 'bk.err.save', 'bk.err.failed',
] as const;

describe('T-83: карточка «Резервная копия» в настройках', () => {
  let h: SettingsHarness | undefined;

  beforeEach(() => {
    setLanguage('en');
  });
  afterEach(() => {
    h?.unmount();
    h = undefined;
    document.querySelectorAll('[role="dialog"]').forEach((d) => d.parentElement?.remove());
  });

  function card(): HTMLElement {
    const el = h?.container.querySelector<HTMLElement>('[data-sec="backup"]');
    if (el === null || el === undefined) throw new Error('карточка backup не найдена');
    return el;
  }

  it('две кнопки: создать копию и восстановить; текст говорит про шифрование и все данные', async () => {
    h = await mountSettings();
    const buttons = Array.from(card().querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toEqual([t('bk.exportBtn'), t('bk.restore')]);
    expect(card().textContent).toMatch(/encrypted/i);
    expect(card().textContent).toMatch(/all your data/i);
    expect(card().querySelector('input[type="file"]')).toBeNull(); // выбор файла — внутри диалога
  });

  it('кнопки открывают диалоги создания и восстановления', async () => {
    h = await mountSettings();
    const [exportBtn, restoreBtn] = Array.from(card().querySelectorAll('button'));
    act(() => {
      exportBtn?.click();
    });
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(t('bk.exportTitle'));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    act(() => {
      restoreBtn?.click();
    });
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(t('bk.restoreTitle'));
  });

  it('confirm_text_mentions_security_settings', () => {
    // подтверждение замены предупреждает: настройки безопасности тоже заменяются
    const en = t('bk.confirmText', 'en');
    for (const part of [/AI agents/, /web panel/i, /core secrets/i, /cannot be undone/i]) expect(en).toMatch(part);
    for (const lang of LANGUAGES) {
      if (lang === 'en') continue;
      const text = t('bk.confirmText', lang);
      expect(text, `bk.confirmText (${lang})`).not.toBe(en);
      expect(text.length, `bk.confirmText (${lang})`).toBeGreaterThan(60);
    }
  });

  it('все строки копии переведены на пять языков', () => {
    for (const lang of LANGUAGES) {
      for (const key of BK_KEYS) {
        const text = t(key, lang);
        expect(text, `${key} (${lang})`).not.toBe(key);
        expect(text.trim(), `${key} (${lang})`).not.toBe('');
      }
      expect(t('bk.hint', lang), `bk.hint (${lang})`).not.toMatch(/Happ/i);
    }
    // пароль и размеры — в одной форме во всех языках: плейсхолдер {n} сохранён
    for (const lang of LANGUAGES) {
      expect(t('bk.pwHint', lang)).toContain('{n}');
      expect(t('bk.pwShort', lang)).toContain('{n}');
    }
  });
});
