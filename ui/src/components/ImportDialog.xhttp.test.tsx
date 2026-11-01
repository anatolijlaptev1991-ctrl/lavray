// SPDX-License-Identifier: GPL-3.0-only

// ImportDialog.xhttp.test.tsx — предпросмотр импорта ссылки XHTTP: профиль в списке
// помечен бейджем «не поддерживается ядром», над списком — предупреждение (хвосты B, 7.4).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { ImportContentResponseSchema, ProfileSchema } from '../gen/lavray_pb';
import { setLanguage, tf } from '../lib/i18n';
import { buttonByText, click, makeClients, mountWithCore, profileOf, typeInto } from '../test-harness';
import { ImportDialog } from './ImportDialog';

const LINK = 'vless://b831381d-6324-4d53-ad4f-8cda48b30811@xh.example.org:443?type=xhttp#XH';

beforeEach(() => {
  setLanguage('en');
  window.localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

describe('предпросмотр импорта XHTTP', () => {
  it('xhttp_badge: в списке профиль с бейджем, рядом предупреждение xhttp_unsupported', async () => {
    const clients = makeClients();
    vi.spyOn(clients.profiles, 'importContent').mockResolvedValue(
      create(ImportContentResponseSchema, {
        parsedProfiles: [
          create(ProfileSchema, { ...profileOf(0, 'XH'), unsupportedReason: 'xhttp_unsupported' }),
          profileOf(0, 'WS'),
        ],
        log: ['xhttp_unsupported: профиль «XH» использует транспорт, который ядро пока не поддерживает'],
      }),
    );
    const m = await mountWithCore(clients, createElement(ImportDialog, { onClose: () => undefined, onImported: () => undefined }));
    const dlg = document.querySelector<HTMLElement>('[role="dialog"]')!;
    typeInto(dlg.querySelector<HTMLInputElement>('#impLink'), LINK);
    await click(buttonByText(dlg, 'Import'));

    const rows = Array.from(dlg.querySelectorAll('.imp-prev-list li'));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.badge-warn')?.textContent).toBe('XHTTP: not supported by the core');
    expect(rows[1]?.querySelector('.badge-warn')).toBeNull();
    expect(dlg.querySelector('.banner-warn')?.textContent).toContain(tf('imp.warn.xhttp', { n: 1 }));
    m.unmount();
  });

  it('обычная ссылка — ни бейджа, ни предупреждения (E)', async () => {
    const clients = makeClients();
    vi.spyOn(clients.profiles, 'importContent').mockResolvedValue(
      create(ImportContentResponseSchema, { parsedProfiles: [profileOf(0, 'WS')] }),
    );
    const m = await mountWithCore(clients, createElement(ImportDialog, { onClose: () => undefined, onImported: () => undefined }));
    const dlg = document.querySelector<HTMLElement>('[role="dialog"]')!;
    typeInto(dlg.querySelector<HTMLInputElement>('#impLink'), LINK);
    await click(buttonByText(dlg, 'Import'));
    expect(dlg.querySelector('.badge-warn')).toBeNull();
    expect(dlg.querySelector('.banner-warn')).toBeNull();
    m.unmount();
  });
});
