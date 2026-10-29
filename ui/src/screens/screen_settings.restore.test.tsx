// SPDX-License-Identifier: GPL-3.0-only

// screen_settings.restore.test.tsx — U-02: восстановление из резервной копии
// спрашивает подтверждение, отмена ничего не шлёт, после применения настройки
// перечитываются, а непринятые ядром ключи показываются ошибкой.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { create } from '@bufbuild/protobuf';
import { SettingDescriptorSchema, SettingType } from '../gen/lavray_pb';
import type { SettingDescriptor } from '../gen/lavray_pb';
import { setLanguage, t, tf } from '../lib/i18n';
import { flush, mountSettings, settingValue, type SettingsHarness } from '../test-utils/settingsKit';

function desc(key: string, type: SettingType): SettingDescriptor {
  return create(SettingDescriptorSchema, { key, type, groupId: 'test', requiresProfileRestart: false });
}

const DESCRIPTORS: readonly SettingDescriptor[] = [
  desc('inbound.port', SettingType.INT),
  desc('ui.max_log_lines', SettingType.INT),
];

/** В файле две известные настройки и одна неизвестная (она не уходит в ядро). */
const BACKUP = JSON.stringify({ 'inbound.port': 3000, 'ui.max_log_lines': 500, 'unknown.key': 1 });

/**
 * Выбор файла в поле «Восстановить из файла…». jsdom не реализует File.text(),
 * поэтому подставляем объект с text(), который отдаёт содержимое.
 */
async function chooseFile(h: SettingsHarness, body: string): Promise<void> {
  const input = h.container.querySelector<HTMLInputElement>('[data-sec="backup"] input[type="file"]');
  if (input === null) throw new Error('поле выбора файла не найдено');
  Object.defineProperty(input, 'files', {
    value: [{ text: (): Promise<string> => Promise.resolve(body) }],
    configurable: true,
  });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

/** Кнопка в открытом диалоге по точному тексту. */
function dialogButton(label: string): HTMLButtonElement {
  const found = Array.from(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
    (b) => (b.textContent ?? '').trim() === label,
  );
  if (found === undefined) throw new Error(`кнопка «${label}» в диалоге не найдена`);
  return found;
}

function clickButton(button: HTMLButtonElement): void {
  act(() => {
    button.click();
  });
}

describe('U-02: восстановление из резервной копии', () => {
  let h: SettingsHarness | undefined;

  beforeEach(() => {
    setLanguage('en');
  });

  afterEach(() => {
    h?.unmount();
    h = undefined;
  });

  it('отмена подтверждения ничего не отправляет и не перечитывает настройки', async () => {
    h = await mountSettings({ 'inbound.port': 2080 }, '9.9.9-core', DESCRIPTORS);
    await chooseFile(h, BACKUP);
    expect(dialog()?.textContent ?? '').toContain(tf('bk.restoreConfirm', { n: 2 }));
    clickButton(dialogButton(t('common.cancel')));
    await flush();
    expect(dialog()).toBeNull();
    expect(h.setSettings).not.toHaveBeenCalled();
    expect(h.getSettings).toHaveBeenCalledTimes(1);
  });

  it('подтверждение отправляет известные настройки, перечитывает их и говорит «восстановлено»', async () => {
    h = await mountSettings({ 'inbound.port': 2080 }, '9.9.9-core', DESCRIPTORS);
    h.getSettings.mockResolvedValueOnce({ values: { 'inbound.port': settingValue(3000) } });
    await chooseFile(h, BACKUP);
    clickButton(dialogButton(t('bk.restoreOk')));
    await flush();
    expect(h.setSettings).toHaveBeenCalledTimes(1);
    expect(h.setSettings.mock.calls[0]?.[0].values).toMatchObject({
      'inbound.port': { value: { case: 'intValue', value: 3000n } },
      'ui.max_log_lines': { value: { case: 'intValue', value: 500n } },
    });
    expect(h.setSettings.mock.calls[0]?.[0].values).not.toHaveProperty('unknown.key');
    expect(h.getSettings).toHaveBeenCalledTimes(2);
    expect((document.getElementById('inbound.port') as HTMLInputElement).value).toBe('3000');
    expect(document.querySelector('[role="status"]')?.textContent).toBe(t('bk.restored'));
  });

  it('если ядро приняло не все ключи, показывает ошибку со списком непринятых и не пишет «восстановлено»', async () => {
    h = await mountSettings({ 'inbound.port': 2080 }, '9.9.9-core', DESCRIPTORS);
    h.setSettings.mockResolvedValueOnce({ acceptedKeys: ['inbound.port'] });
    await chooseFile(h, BACKUP);
    clickButton(dialogButton(t('bk.restoreOk')));
    await flush();
    const alert = document.querySelector('[role="alert"]')?.textContent ?? '';
    expect(alert).toContain('ui.max_log_lines');
    expect(alert).not.toContain('inbound.port');
    expect(document.querySelector('[role="status"]')?.textContent ?? '').not.toBe(t('bk.restored'));
  });

  it('файл без известных настроек не открывает подтверждение и ничего не шлёт', async () => {
    h = await mountSettings({}, '9.9.9-core', DESCRIPTORS);
    await chooseFile(h, JSON.stringify({ 'unknown.key': 1 }));
    expect(dialog()).toBeNull();
    expect(h.setSettings).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(t('bk.restoreEmpty'));
  });
});
