// SPDX-License-Identifier: GPL-3.0-only

// T-35: на экране «Настройки» не должно быть переключателей, которых никто не
// читает, двух переключателей на одном ключе и повторяющихся подписей.
//   - ui.start_minimal сидел сразу под двумя подписями («Запускать свёрнутым»
//     и «Сворачивать в трей при закрытии»); оболочка его не читает
//     (shell/src/main.rs: закрытие в трей безусловно, окно при старте всегда);
//   - tun.enabled ядро не читает (TUN берётся из режима Connect);
//   - ui.conn_stat — всегда true (FR-UI-274), читателя нет;
//   - tun.kill_switch был подписан «Строгий маршрут», как tun.strict_route; теперь
//     «Строгая маршрутизация (strict_route)» без обещания блокировки при падении ядра.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { setLanguage } from '../lib/i18n';
import { flush, mountSettings, switches, type SettingsHarness } from '../test-utils/settingsKit';

/** Ключи, которые никто не читает: переключателей на них быть не должно. */
const KEYS_WITHOUT_READER = ['ui.start_minimal', 'ui.conn_stat', 'tun.enabled'];

async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
    await Promise.resolve();
  });
  await flush();
}

function states(h: SettingsHarness): (string | null)[] {
  return switches(h.container).map((el) => el.getAttribute('aria-checked'));
}

describe('T-35: переключатели настроек', () => {
  let current: SettingsHarness | undefined;

  beforeEach(() => {
    setLanguage('en');
  });

  afterEach(() => {
    current?.unmount();
    current = undefined;
  });

  it('подписи переключателей не повторяются', async () => {
    current = await mountSettings();
    const labels = switches(current.container).map((el) => el.getAttribute('aria-label'));
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels).size, `подписи: ${JSON.stringify(labels)}`).toBe(labels.length);
  });

  it('каждый переключатель меняет только себя и пишет собственный ключ', async () => {
    current = await mountSettings();
    const h = current;
    const total = switches(h.container).length;
    const keys: string[] = [];
    for (let i = 0; i < total; i += 1) {
      const before = states(h);
      const callsBefore = h.setSettings.mock.calls.length;
      await click(switches(h.container)[i]!);
      const dlg = document.querySelector<HTMLElement>('[role="dialog"]');
      if (dlg !== null) {
        // «небезопасный TLS» (T-11) сперва спрашивает подтверждение — отменяем
        await click(Array.from(dlg.querySelectorAll('button')).find((b) => b.textContent === 'Cancel')!);
        expect(h.setSettings.mock.calls.length).toBe(callsBefore);
        continue;
      }
      const after = states(h);
      const changed = after.flatMap((s, k) => (s !== before[k] ? [k] : []));
      expect(changed, `клик по переключателю №${String(i)} меняет и другие`).toEqual([i]);
      expect(h.setSettings.mock.calls.length, `переключатель №${String(i)} не записал настройку`).toBe(callsBefore + 1);
      keys.push(...Object.keys(h.setSettings.mock.calls[callsBefore]![0].values));
    }
    expect(new Set(keys).size, `ключи: ${JSON.stringify(keys)}`).toBe(keys.length);
    for (const dead of KEYS_WITHOUT_READER) {
      expect(keys, `переключатель на ключе без читателя ${dead}`).not.toContain(dead);
    }
  });

  it('tun.kill_switch подписан «Строгая маршрутизация» и не обещает блокировку при падении ядра', async () => {
    current = await mountSettings();
    const strict = switches(current.container).find((el) => /strict_route/i.test(el.getAttribute('aria-label') ?? ''));
    expect(strict, 'переключатель tun.kill_switch должен остаться, но под честным именем').toBeDefined();
    const text = strict!.closest('.set-row')?.querySelector('.set-d')?.textContent ?? '';
    expect(text).not.toMatch(/not implemented/i);
    expect(text).toMatch(/nothing is blocked/i);
    await click(strict!);
    expect(Object.keys(current.setSettings.mock.calls[0]![0].values)).toEqual(['tun.kill_switch']);
  });

  it('connect.kill_switch_proxy: переключатель пишет собственный ключ', async () => {
    current = await mountSettings();
    const proxy = switches(current.container).find((el) => /keep the proxy/i.test(el.getAttribute('aria-label') ?? ''));
    expect(proxy, 'переключатель kill switch прокси').toBeDefined();
    await click(proxy!);
    expect(Object.keys(current.setSettings.mock.calls[0]![0].values)).toEqual(['connect.kill_switch_proxy']);
  });

  it('пустых разделов «Поведение» и «Системная интеграция» в оглавлении нет', async () => {
    current = await mountSettings();
    const toc = Array.from(current.container.querySelectorAll('.set-toc button')).map((b) => b.textContent);
    expect(toc).not.toContain('Behavior');
    expect(toc).not.toContain('System integration');
    expect(current.container.querySelector('[data-sec="behavior"]')).toBeNull();
    expect(current.container.querySelector('[data-sec="integration"]')).toBeNull();
  });
});
