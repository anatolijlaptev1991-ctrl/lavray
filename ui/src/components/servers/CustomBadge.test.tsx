// SPDX-License-Identifier: GPL-3.0-only

// CustomBadge.test.tsx — T-08B: бейдж «custom: не подтверждено» показан только у профиля
// с неподтверждённым custom-содержимым, открывает diff-диалог и доступен с клавиатуры.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  CustomDetail_Core,
  CustomDetailSchema,
  PreviewCustomFieldsResponseSchema,
  ProfileSchema,
  ProfileType,
} from '../../gen/lavray_pb';
import type { Profile } from '../../gen/lavray_pb';
import { setLanguage, t } from '../../lib/i18n';
import { buttonByText, click, makeClients, mountWithCore } from '../../test-harness';
import type { Mounted } from '../../test-harness';
import { CustomBadge } from './CustomBadge';

type ProfileInit = MessageInitShape<typeof ProfileSchema>;
const profile = (extra: ProfileInit = {}): Profile =>
  create(ProfileSchema, { id: 7n, type: ProfileType.VLESS, name: 'Node A', address: 'a.example.org', port: 443, ...extra });
const fullConfig = (confirmed: boolean): Profile =>
  profile({
    type: ProfileType.CUSTOM_CONFIG,
    customFieldsConfirmed: confirmed,
    detail: {
      case: 'custom',
      value: create(CustomDetailSchema, { core: CustomDetail_Core.INTERNAL_FULL, fullConfigJson: '{"log":{}}' }),
    },
  });

describe('CustomBadge (T-08B)', () => {
  let mounted: Mounted | undefined;

  beforeEach(() => {
    setLanguage('en');
    window.localStorage.clear();
  });
  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function render(p: Profile, onConfirmed = vi.fn()): Promise<ReturnType<typeof makeClients>> {
    const clients = makeClients();
    vi.spyOn(clients.profiles, 'previewCustomFields').mockResolvedValue(
      create(PreviewCustomFieldsResponseSchema, { customHash: 'd'.repeat(64), diff: '--- before\n+++ after\n@@ -1 +1 @@\n-a\n+b' }),
    );
    vi.spyOn(clients.profiles, 'confirmCustomFields').mockResolvedValue(profile({ customFieldsConfirmed: true }));
    mounted = await mountWithCore(clients, createElement(CustomBadge, { profile: p, onConfirmed }));
    return clients;
  }
  const badge = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('.cf-badge');

  it.each<[string, ProfileInit]>([
    ['custom outbound JSON', { customOutboundJson: '{"a":1}' }],
    ['custom config JSON', { customConfigJson: '{"dns":{}}' }],
    ['оба поля', { customOutboundJson: '{"a":1}', customConfigJson: '{"dns":{}}' }],
  ])('показан: %s, ядро не подтвердило', async (_name, extra) => {
    await render(profile({ ...extra, customFieldsConfirmed: false }));
    expect(badge()).not.toBeNull();
    expect(badge()?.textContent).toBe(t('cf.badge'));
  });

  it('показан у профиля CUSTOM_CONFIG с полным конфигом (internal-full)', async () => {
    await render(fullConfig(false));
    expect(badge()).not.toBeNull();
  });

  it.each<[string, Profile]>([
    ['custom-поля подтверждены', profile({ customOutboundJson: '{"a":1}', customFieldsConfirmed: true })],
    ['полный конфиг подтверждён', fullConfig(true)],
    ['custom-полей нет', profile()],
    ['пустая строка', profile({ customOutboundJson: '', customConfigJson: '  ' })],
    ['пустой объект {}', profile({ customOutboundJson: '{}', customConfigJson: ' { } ' })],
  ])('не показан: %s', async (_name, p) => {
    await render(p);
    expect(badge()).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('клик открывает диалог подтверждения для этого профиля; подтверждение зовёт onConfirmed', async () => {
    const onConfirmed = vi.fn();
    const clients = await render(profile({ customOutboundJson: '{"a":1}' }), onConfirmed);
    await click(badge());
    expect(clients.profiles.previewCustomFields).toHaveBeenCalledWith({ profileId: 7n });
    const dlg = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dlg?.querySelector('.cf-for')?.textContent).toContain('Node A');

    await click(dlg?.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    await click(buttonByText(dlg ?? document.body, t('cf.apply')));
    expect(clients.profiles.confirmCustomFields).toHaveBeenCalledWith({ profileId: 7n, customHash: 'd'.repeat(64) });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Esc закрывает диалог без подтверждения и возвращает фокус на бейдж', async () => {
    const onConfirmed = vi.fn();
    const clients = await render(profile({ customOutboundJson: '{"a":1}' }), onConfirmed);
    act(() => {
      badge()?.focus();
    });
    await click(badge());
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(clients.profiles.confirmCustomFields).not.toHaveBeenCalled();
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(badge());
  });

  it('доступен с клавиатуры: настоящая кнопка в порядке Tab, имя содержит видимый текст и имя профиля', async () => {
    await render(profile({ customConfigJson: '{"dns":{}}' }));
    const el = badge();
    expect(el?.tagName).toBe('BUTTON');
    expect(el?.type).toBe('button');
    expect(el?.disabled).toBe(false);
    expect(el?.tabIndex).toBe(0);
    expect(el?.closest('button:not(.cf-badge)')).toBeNull(); // не вложена в другую кнопку
    expect(el?.getAttribute('aria-label')).toBe(`${t('cf.badge')} (Node A)`);
    expect(el?.getAttribute('aria-label')).toContain(el?.textContent ?? '?');
    expect(el?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(el?.title).toBe(t('cf.badgeTip'));
    act(() => {
      el?.focus();
    });
    expect(document.activeElement).toBe(el);
  });
});
