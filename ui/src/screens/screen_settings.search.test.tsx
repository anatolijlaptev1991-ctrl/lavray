// SPDX-License-Identifier: GPL-3.0-only

// T-71 (B2-19, B2-20, C2-07): поле «Поиск по настройкам» ищет по ВСЕМ разделам
// (раньше — только по сети, TUN и «ядру»: «язык», «тема», «резервная копия»
// не находились), а версии приложения и ядра берутся из сборки и статуса ядра,
// а не из литерала `v0.1.0`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { setLanguage, t, type MessageKey } from '../lib/i18n';
import { mountSettings, type SettingsHarness } from '../test-utils/settingsKit';

vi.mock('../lib/version', () => ({ APP_VERSION: '9.9.9-test' }));

/** Разделы экрана в порядке отображения (после T-35 — без «Поведения» и «Системной интеграции»). */
const SECTION_IDS = ['general', 'network', 'tun', 'hotkeys', 'appearance', 'backup', 'core', 'about'];

/** [раздел, ключ подписи строки этого раздела] — запрос берётся из словаря, а не зашит. */
const ROW_OF_SECTION: readonly (readonly [string, MessageKey])[] = [
  ['general', 'set.lang'],
  ['network', 'set.port'],
  ['tun', 'tun.mtu'],
  ['hotkeys', 'hk.toggle'],
  ['appearance', 'set.accent'],
  ['backup', 'bk.restore'],
  ['core', 'set.coreVersion'],
  ['about', 'about.bug'],
];

async function search(h: SettingsHarness, text: string): Promise<void> {
  const input = h.container.querySelector<HTMLInputElement>('.set-search input')!;
  // React слушает «input»; value надо выставлять через нативный сеттер
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    descriptor?.set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

function shownSections(h: SettingsHarness): string[] {
  return Array.from(h.container.querySelectorAll<HTMLElement>('.set-card')).map((c) => c.dataset.sec ?? '');
}

describe('T-71: поиск по настройкам и версии', () => {
  let current: SettingsHarness | undefined;

  beforeEach(() => {
    setLanguage('en');
  });

  afterEach(() => {
    current?.unmount();
    current = undefined;
  });

  it('без запроса видны все разделы', async () => {
    current = await mountSettings();
    expect(shownSections(current)).toEqual(SECTION_IDS);
  });

  it.each(ROW_OF_SECTION)('раздел «%s» находится по подписи своей строки (%s)', async (section, labelKey) => {
    current = await mountSettings();
    await search(current, t(labelKey, 'en'));
    expect(shownSections(current)).toContain(section);
    const toc = Array.from(current.container.querySelectorAll('.set-toc button')).map((b) => b.textContent);
    expect(toc).toContain(t(`sec.${section}` as MessageKey, 'en'));
  });

  it('запрос без совпадений скрывает все разделы', async () => {
    current = await mountSettings();
    await search(current, 'zzzz-нет-такой-настройки');
    expect(shownSections(current)).toEqual([]);
  });

  it('если запрос совпал с названием раздела, раздел показан целиком', async () => {
    current = await mountSettings();
    await search(current, t('sec.network', 'en'));
    expect(shownSections(current)).toContain('network');
    for (const id of ['inbound.address', 'inbound.port', 'inbound.auth.user', 'inbound.auth.pass']) {
      expect(current.container.querySelector(`[data-sec="network"] [id="${id}"]`), id).not.toBeNull();
    }
  });

  it('версия приложения берётся из сборки, версия ядра — из статуса ядра', async () => {
    current = await mountSettings({}, '7.7.7-core');
    const core = current.container.querySelector('[data-sec="core"]')?.textContent ?? '';
    const about = current.container.querySelector('[data-sec="about"]')?.textContent ?? '';
    expect(core).toContain('v9.9.9-test');
    expect(about).toContain('v9.9.9-test');
    expect(core).toContain('7.7.7-core');
    expect(core + about).not.toContain('v0.1.0');
  });
});
