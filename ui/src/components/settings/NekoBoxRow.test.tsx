// SPDX-License-Identifier: GPL-3.0-only

// NekoBoxRow.test.tsx — строка «Перенос из NekoBox» в «Настройках» (T-78): кнопка
// открывает диалог переноса; подписи переведены на пять языков.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LANGUAGES, setLanguage, t } from '../../lib/i18n';
import { flush, mountSettings, type SettingsHarness } from '../../test-utils/settingsKit';

const KEYS = [
  'nb.row.l', 'nb.row.d', 'nb.row.btn', 'nb.title', 'nb.intro', 'nb.path', 'nb.pathHint', 'nb.pick', 'nb.found',
  'nb.none', 'nb.routes', 'nb.settings', 'nb.closeWarn', 'nb.preview', 'nb.import', 'nb.previewNote',
  'nb.reportTitle', 'nb.skipped', 'nb.warnings', 'nb.activate', 'nb.done', 'nb.err.empty', 'nb.err.invalid',
  'nb.err.busy', 'nb.err.generic', 'onb.neko.found', 'onb.neko.report', 'onb.neko.d',
] as const;

describe('T-78: строка «Перенос из NekoBox» в настройках', () => {
  let h: SettingsHarness | undefined;

  beforeEach(() => {
    setLanguage('en');
  });
  afterEach(() => {
    h?.unmount();
    h = undefined;
    document.querySelectorAll('[role="dialog"]').forEach((d) => d.parentElement?.remove());
  });

  it('settings_entry_opens_dialog: кнопка в карточке открывает диалог переноса, Esc закрывает', async () => {
    h = await mountSettings();
    const card = h.container.querySelector<HTMLElement>('[data-sec="backup"]');
    const button = Array.from(card?.querySelectorAll('button') ?? []).find((b) => b.textContent === t('nb.row.btn'));
    expect(button, 'кнопка переноса в карточке').toBeDefined();
    expect(card?.textContent).toContain(t('nb.row.d'));
    act(() => {
      button?.click();
    });
    await flush();
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(t('nb.title'));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('все строки переноса переведены на пять языков, без «Happ» и без потерянных {…}', () => {
    for (const lang of LANGUAGES) {
      for (const key of KEYS) {
        const text = t(key, lang);
        expect(text, `${key} (${lang})`).not.toBe(key);
        expect(text.trim(), `${key} (${lang})`).not.toBe('');
        expect(text, `${key} (${lang})`).not.toMatch(/Happ/i);
      }
      expect(t('onb.neko.found', lang)).toContain('{servers}');
      expect(t('onb.neko.report', lang)).toContain('{routes}');
    }
  });
});
