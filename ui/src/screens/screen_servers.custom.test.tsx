// SPDX-License-Identifier: GPL-3.0-only

// screen_servers.custom.test.tsx — T-08B: в списке серверов у профиля с неподтверждённым
// custom-содержимым есть бейдж; подтверждение через diff перечитывает список.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { PreviewCustomFieldsResponseSchema, ProfileSchema } from '../gen/lavray_pb';
import { setLanguage, t } from '../lib/i18n';
import { buttonByText, click, makeClients, mountWithCore, profileOf } from '../test-harness';
import { ServersScreen } from './screen_servers';

beforeEach(() => {
  setLanguage('en');
  window.localStorage.clear();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

describe('«Серверы»: бейдж неподтверждённых custom-полей (T-08B)', () => {
  const custom = create(ProfileSchema, { ...profileOf(2, 'Custom node'), customOutboundJson: '{"a":1}' });

  it('бейдж только у строки с неподтверждённым custom-содержимым; клик → диалог → подтверждение → список перечитан', async () => {
    const clients = makeClients({ profiles: [profileOf(1, 'Plain node'), custom] });
    vi.spyOn(clients.profiles, 'previewCustomFields').mockResolvedValue(
      create(PreviewCustomFieldsResponseSchema, { customHash: 'e'.repeat(64), diff: '' }),
    );
    vi.spyOn(clients.profiles, 'confirmCustomFields').mockResolvedValue(
      create(ProfileSchema, { ...custom, customFieldsConfirmed: true }),
    );
    const m = await mountWithCore(clients, createElement(ServersScreen));

    const rows = Array.from(m.container.querySelectorAll('.prow'));
    expect(rows).toHaveLength(2);
    const hasBadge = Object.fromEntries(
      rows.map((r) => [r.querySelector('.prow-name')?.textContent ?? '', r.querySelector('.cf-badge') !== null]),
    );
    expect(hasBadge).toEqual({ 'Plain node': false, 'Custom node': true });
    const badge = m.container.querySelector<HTMLButtonElement>('.cf-badge');
    // бейдж — сосед основной кнопки строки, а не её потомок
    expect(badge?.closest('.prow-main')).toBeNull();

    const listCalls = vi.mocked(clients.profiles.listProfiles).mock.calls.length;
    await click(badge);
    expect(clients.profiles.previewCustomFields).toHaveBeenCalledWith({ profileId: 2n });
    const dlg = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dlg).not.toBeNull();
    await click(dlg?.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    await click(buttonByText(dlg ?? document.body, t('cf.apply')));
    expect(clients.profiles.confirmCustomFields).toHaveBeenCalledWith({ profileId: 2n, customHash: 'e'.repeat(64) });
    expect(vi.mocked(clients.profiles.listProfiles).mock.calls.length).toBeGreaterThan(listCalls);
    m.unmount();
  });

  it('у подтверждённого профиля бейджа нет', async () => {
    const confirmed = create(ProfileSchema, { ...custom, customFieldsConfirmed: true });
    const m = await mountWithCore(makeClients({ profiles: [confirmed] }), createElement(ServersScreen));
    expect(m.container.querySelector('.cf-badge')).toBeNull();
    m.unmount();
  });
});
