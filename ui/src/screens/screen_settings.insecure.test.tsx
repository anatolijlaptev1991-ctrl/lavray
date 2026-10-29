// SPDX-License-Identifier: GPL-3.0-only

// T-11: переключатель security.allow_insecure_default отключает проверку
// TLS-сертификатов у ВСЕХ серверов (core/internal/cfgbuild/outbounds.go:
// `s.AllowInsecure || st.AllowInsecureDefault`). Он обязан называться честно,
// описывать риск и включаться только после подтверждения.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { LANGUAGES, setLanguage, t } from '../lib/i18n';
import {
  flush,
  mountSettings,
  switches,
  type RawSettings,
  type SettingsHarness,
} from '../test-utils/settingsKit';

const KEY = 'security.allow_insecure_default';

function insecureSwitch(h: SettingsHarness): HTMLElement {
  const found = switches(h.container).find((el) => /certificate/i.test(el.getAttribute('aria-label') ?? ''));
  if (found === undefined) {
    const labels = switches(h.container).map((el) => el.getAttribute('aria-label'));
    throw new Error(`переключатель проверки сертификатов не найден; подписи переключателей: ${JSON.stringify(labels)}`);
  }
  return found;
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
    await Promise.resolve();
  });
  await flush();
}

describe('T-11: «Совместимость» — отключение проверки TLS', () => {
  let current: SettingsHarness | undefined;

  async function open(initial?: RawSettings): Promise<SettingsHarness> {
    current = await mountSettings(initial);
    return current;
  }

  beforeEach(() => {
    setLanguage('en');
  });

  afterEach(() => {
    current?.unmount();
    current = undefined;
  });

  it('подпись прямо говорит, что сертификаты не проверяются, и описывает риск', async () => {
    const h = await open();
    const sw = insecureSwitch(h);
    expect(sw.getAttribute('aria-label')).toMatch(/insecure TLS/i);
    const row = sw.closest('.set-row');
    expect(row?.querySelector('.set-d')?.textContent ?? '').toMatch(/intercept|impersonat/i);
    expect(h.container.textContent ?? '').not.toContain('Compatibility');
  });

  it('включение требует подтверждения: до него настройка не пишется', async () => {
    const h = await open();
    const sw = insecureSwitch(h);
    await click(sw);
    expect(dialog(), 'диалог подтверждения').not.toBeNull();
    expect(h.setSettings).not.toHaveBeenCalled();
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });

  it('«Отмена» оставляет проверку включённой и ничего не пишет', async () => {
    const h = await open();
    await click(insecureSwitch(h));
    const cancel = Array.from(dialog()?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Cancel');
    expect(cancel, 'кнопка «Cancel» в диалоге').toBeDefined();
    await click(cancel!);
    expect(dialog()).toBeNull();
    expect(h.setSettings).not.toHaveBeenCalled();
    expect(insecureSwitch(h).getAttribute('aria-checked')).toBe('false');
  });

  it('подтверждение записывает true и показывает предупреждение, пока опция включена', async () => {
    const h = await open();
    await click(insecureSwitch(h));
    const confirm = dialog()?.querySelector<HTMLElement>('.btn-danger-solid');
    expect(confirm, 'опасная кнопка подтверждения').not.toBeNull();
    await click(confirm!);
    expect(dialog()).toBeNull();
    expect(h.setSettings).toHaveBeenCalledTimes(1);
    const sent = h.setSettings.mock.calls[0]?.[0].values[KEY]?.value;
    expect(sent).toEqual({ case: 'boolValue', value: true });
    expect(insecureSwitch(h).getAttribute('aria-checked')).toBe('true');
    expect(h.container.querySelector('.banner-warn[role="status"]')?.textContent ?? '').toMatch(/verification is off/i);
  });

  it('выключение безопасно и подтверждения не просит', async () => {
    const h = await open({ [KEY]: true });
    expect(h.container.querySelector('.banner-warn[role="status"]')).not.toBeNull();
    await click(insecureSwitch(h));
    expect(dialog()).toBeNull();
    expect(h.setSettings).toHaveBeenCalledTimes(1);
    expect(h.setSettings.mock.calls[0]?.[0].values[KEY]?.value).toEqual({ case: 'boolValue', value: false });
    expect(h.container.querySelector('.banner-warn[role="status"]')).toBeNull();
  });

  it('во всех пяти языках подпись называет TLS и не повторяет «Совместимость»', () => {
    for (const lang of LANGUAGES) {
      expect(t('set.insecure', lang), lang).toContain('TLS');
      expect(t('set.insecure', lang), lang).not.toBe(t('dns.warn.t', lang));
      for (const key of [
        'set.insecure.d',
        'set.insecure.on',
        'set.insecure.confirm.t',
        'set.insecure.confirm.d',
        'set.insecure.confirm.ok',
      ] as const) {
        expect(t(key, lang), `${key} (${lang})`).not.toBe(key);
      }
    }
  });
});
