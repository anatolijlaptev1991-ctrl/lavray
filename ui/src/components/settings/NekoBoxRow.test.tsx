// SPDX-License-Identifier: GPL-3.0-only

// NekoBoxRow.test.tsx — строка «Перенос из NekoBox» в «Настройках» (T-78): кнопка
// открывает диалог переноса; после переноса экран перечитывает настройки и
// подсказывает о перезапуске; подписи переведены на пять языков.
import { create } from '@bufbuild/protobuf';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NekoBoxReportSchema, SettingDescriptorSchema } from '../../gen/lavray_pb';
import { LANGUAGES, setLanguage, t } from '../../lib/i18n';
import { flush, mountSettings, type SettingsHarness } from '../../test-utils/settingsKit';

const KEYS = [
  'nb.row.l', 'nb.row.d', 'nb.row.btn', 'nb.title', 'nb.intro', 'nb.path', 'nb.pathHint', 'nb.pick', 'nb.found',
  'nb.none', 'nb.routes', 'nb.settings', 'nb.closeWarn', 'nb.preview', 'nb.import', 'nb.previewNote',
  'nb.reportTitle', 'nb.skipped', 'nb.warnings', 'nb.activate', 'nb.done', 'nb.err.empty', 'nb.err.invalid',
  'nb.err.busy', 'nb.err.generic', 'nb.restartProfile', 'nb.restartApp', 'onb.neko.found', 'onb.neko.report',
  'onb.neko.d',
] as const;

/** Подставное ядро переноса: отчёт сообщает перенесённый ключ inbound.port. */
async function mountWithImport(restart: { profile?: boolean; app?: boolean }): Promise<SettingsHarness> {
  const report = create(NekoBoxReportSchema, { groupsImported: 1, settingsImported: ['inbound.port'] });
  const migration = {
    detectNekoBox: vi.fn(() => Promise.resolve({ candidates: [] })),
    previewNekoBoxImport: vi.fn(() => Promise.resolve({ ...report, dryRun: true })),
    importNekoBox: vi.fn(() => Promise.resolve(report)),
  };
  const descriptors = [
    create(SettingDescriptorSchema, {
      key: 'inbound.port',
      requiresProfileRestart: restart.profile === true,
      requiresAppRestart: restart.app === true,
    }),
  ];
  return mountSettings({}, '1.0.0', descriptors, { migration });
}

const dialogButton = (label: string): HTMLButtonElement | undefined =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
    (b) => (b.textContent ?? '').trim() === label,
  );

async function press(label: string): Promise<void> {
  act(() => {
    dialogButton(label)?.click();
  });
  await flush();
}

/** Открывает диалог из карточки, вводит путь, делает предпросмотр и перенос. */
async function runImport(harness: SettingsHarness): Promise<void> {
  const card = harness.container.querySelector<HTMLElement>('[data-sec="backup"]');
  const open = Array.from(card?.querySelectorAll('button') ?? []).find((b) => b.textContent === t('nb.row.btn'));
  act(() => {
    open?.click();
  });
  await flush();
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const input = document.querySelector<HTMLInputElement>('#nbPath');
  act(() => {
    descriptor?.set?.call(input, 'C:/neko/config');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await press(t('nb.preview'));
  await press(t('nb.import'));
}

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

  it('import_refreshes_settings_screen: после переноса открытый экран перечитывает настройки', async () => {
    h = await mountWithImport({});
    const before = h.getSettings.mock.calls.length;
    await runImport(h);
    expect(h.getSettings.mock.calls.length).toBe(before + 1);
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(t('nb.restartProfile'));
  });

  it('restart_hint_shown: ключ, требующий перезапуска профиля или приложения, даёт подсказку', async () => {
    h = await mountWithImport({ profile: true });
    await runImport(h);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(t('nb.restartProfile'));
    h.unmount();
    document.querySelectorAll('[role="dialog"]').forEach((d) => d.parentElement?.remove());
    h = await mountWithImport({ app: true });
    await runImport(h);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(t('nb.restartApp'));
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
