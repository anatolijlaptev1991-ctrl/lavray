// SPDX-License-Identifier: GPL-3.0-only

// screen_settings.agents.test.tsx — MCP: раздел «Агенты (MCP)» на экране
// «Настройки» читает режим из настроек ядра, записывает изменение через
// SetSettings и сообщает его оболочке. Оболочка (Tauri) подменена.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { setLanguage, t } from '../lib/i18n';
import { flush, mountSettings, type SettingsHarness } from '../test-utils/settingsKit';

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));

describe('экран «Настройки»: Агенты (MCP)', () => {
  let h: SettingsHarness | undefined;

  const select = (): HTMLSelectElement =>
    h!.container.querySelector<HTMLSelectElement>('[data-sec="agents"] #agentMode')!;

  async function choose(mode: string): Promise<void> {
    const el = select();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(el, mode);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
  }

  beforeEach(() => {
    setLanguage('en');
    shell.invoke.mockReset().mockResolvedValue(null);
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    h?.unmount();
    h = undefined;
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('раздел есть, называется «Агенты (MCP)» и по умолчанию выключен', async () => {
    h = await mountSettings({});
    const card = h.container.querySelector('[data-sec="agents"]');
    expect(card?.querySelector('h2')?.textContent).toBe(t('sec.agents', 'en'));
    expect(select().value).toBe('off');
  });

  it('режим берётся из настроек ядра без отдельного запроса', async () => {
    h = await mountSettings({ 'agent.mode': 'read' });
    expect(select().value).toBe('read');
    expect(h.getSettings).toHaveBeenCalledTimes(1);
  });

  it('изменение пишется в ядро и сообщается оболочке', async () => {
    h = await mountSettings({ 'agent.mode': 'off' });
    await choose('control');
    expect(h.setSettings).toHaveBeenCalledTimes(1);
    expect(h.setSettings.mock.calls[0]?.[0].values).toEqual({
      'agent.mode': expect.objectContaining({ value: { case: 'stringValue', value: 'control' } }) as unknown,
    });
    expect(shell.invoke).toHaveBeenCalledWith('agent_access_set', { mode: 'control' });
    expect(select().value).toBe('control');
    expect(h.container.querySelector('[data-sec="agents"] .banner-warn')).not.toBeNull();
  });

  it('ядро не приняло режим: значение откатывается, оболочке ничего не уходит', async () => {
    h = await mountSettings({ 'agent.mode': 'off' });
    h.setSettings.mockResolvedValueOnce({ acceptedKeys: [] });
    await choose('control');
    expect(select().value).toBe('off');
    expect(shell.invoke.mock.calls.filter(([cmd]) => cmd === 'agent_access_set')).toEqual([]);
  });
});
