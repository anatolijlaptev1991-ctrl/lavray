// screen_subscriptions.settings.test.tsx — регрессия T-21: у карточки подписки
// есть шестерёнка «Настройки подписки» (прототип dlgSubSet): интервал и
// User-Agent пишутся в группу через UpdateGroup, «через туннель» и HWID — в
// общие настройки sub.use_proxy / sub.hwid_enabled. Раньше диалога не было.
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { create } from '@bufbuild/protobuf';
import { GetSettingsResponseSchema, SettingValueSchema, type SettingValue } from '../gen/lavray_pb';
import { fakeCore, PROV, subscriptionsHarness } from './subscriptions.testkit';

const flag = (on: boolean): SettingValue => create(SettingValueSchema, { value: { case: 'boolValue', value: on } });

describe('экран «Подписки»: диалог «Настройки подписки» (T-21)', () => {
  const h = subscriptionsHarness();
  const q = (sel: string): HTMLElement => document.querySelector<HTMLElement>(sel)!;

  /** Открывает диалог у подписки с интервалом 12 ч и UA clash.meta; туннель и HWID выключены. */
  async function open(updateGroup: ReturnType<typeof vi.fn>): Promise<{ setSettings: ReturnType<typeof vi.fn> }> {
    const { core } = fakeCore([{ ...PROV, updateIntervalMin: 720, userAgent: 'clash.meta' }]);
    const setSettings = vi.fn(() => Promise.resolve({}));
    const values = { 'sub.use_proxy': flag(false), 'sub.hwid_enabled': flag(false) };
    Object.assign(core.profiles, { updateGroup });
    Object.assign(core, {
      settings: { getSettings: vi.fn(() => Promise.resolve(create(GetSettingsResponseSchema, { values }))), setSettings },
    });
    await h.mount(core);
    await h.click(q('button[aria-label="Настройки подписки"]'));
    return { setSettings };
  }

  function pick(sel: string, value: string): void {
    act(() => {
      const el = q(sel) as HTMLSelectElement;
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function type(sel: string, value: string): void {
    act(() => {
      const el = q(sel) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  const save = (): HTMLButtonElement => q('.dlg-f .btn-pri') as HTMLButtonElement;

  it('показывает текущие значения и сохраняет только изменённое', async () => {
    const updateGroup = vi.fn(() => Promise.resolve({}));
    const { setSettings } = await open(updateGroup);
    expect(q('#ssTitle').textContent).toBe('Настройки подписки');
    expect((q('#ssInterval') as HTMLSelectElement).value).toBe('12');
    expect((q('#ssUa') as HTMLSelectElement).value).toBe('clash');
    expect(q('#ssTunnel').getAttribute('aria-checked')).toBe('false');

    pick('#ssInterval', '24');
    pick('#ssUa', 'custom');
    type('#ssUaCustom', 'MyUA/1');
    act(() => {
      q('#ssHwid').click();
    });
    await h.click(save());

    const sent = updateGroup.mock.calls[0] as unknown as [{ group: Record<string, unknown> }];
    expect(sent[0].group).toMatchObject({ id: 7n, updateIntervalMin: 1440, userAgent: 'MyUA/1' });
    const values = (setSettings.mock.calls[0] as unknown as [{ values: Record<string, unknown> }])[0].values;
    expect(Object.keys(values)).toEqual(['sub.hwid_enabled']); // туннель не трогали
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('«Сохранить» без правок ничего не отправляет', async () => {
    const updateGroup = vi.fn(() => Promise.resolve({}));
    const { setSettings } = await open(updateGroup);
    await h.click(save());
    expect(updateGroup).not.toHaveBeenCalled();
    expect(setSettings).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('пустой «Свой User-Agent» блокирует сохранение, ошибка ядра оставляет диалог открытым', async () => {
    await open(vi.fn(() => Promise.reject(new Error('user_agent: слишком длинный'))));
    pick('#ssUa', 'custom');
    type('#ssUaCustom', '   ');
    expect(save().disabled).toBe(true);
    type('#ssUaCustom', 'X');
    await h.click(save());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(q('.dlg [role="alert"]').textContent).toContain('слишком длинный');
  });
});
