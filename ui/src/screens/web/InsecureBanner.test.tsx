// SPDX-License-Identifier: GPL-3.0-only

// InsecureBanner.test.tsx — «Не защищено» только на HTTP не на loopback.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { setLanguage } from '../../lib/i18n';
import { mountBare, unmountAll } from '../../test-utils/coreStub';
import { InsecureBanner } from './InsecureBanner';

beforeEach(() => {
  setLanguage('en');
});
afterEach(unmountAll);

const banner = async (
  loc: { protocol: string; hostname: string },
  variant?: 'bar' | 'card',
): Promise<HTMLElement> =>
  (await mountBare(createElement(InsecureBanner, { location: loc, ...(variant ? { variant } : {}) }))).container;

describe('предупреждение «Не защищено»', () => {
  it('insecure_banner_on_http: HTTP по адресу роутера — предупреждение со всей фразой', async () => {
    const c = await banner({ protocol: 'http:', hostname: '192.168.1.1' });
    const el = c.querySelector('[data-testid="insecure-banner"]');
    expect(el?.getAttribute('role')).toBe('status');
    expect(el?.textContent).toContain('Not secure');
    expect(el?.textContent).toContain('Turn on HTTPS');
    expect(el?.classList.contains('web-insecure')).toBe(true);
  });

  it('внутри карточки входа полоса не фиксируется', async () => {
    const c = await banner({ protocol: 'http:', hostname: 'router.lan' }, 'card');
    expect(c.querySelector('.banner')?.classList.contains('web-insecure')).toBe(false);
  });

  it('HTTPS и loopback — без предупреждения', async () => {
    expect((await banner({ protocol: 'https:', hostname: '192.168.1.1' })).querySelector('.banner')).toBeNull();
    expect((await banner({ protocol: 'http:', hostname: '127.0.0.1' })).querySelector('.banner')).toBeNull();
    expect((await banner({ protocol: 'http:', hostname: 'localhost' })).querySelector('.banner')).toBeNull();
  });

  it('текст на языке интерфейса', async () => {
    setLanguage('de');
    const c = await banner({ protocol: 'http:', hostname: '10.0.0.1' });
    expect(c.textContent).toContain('Nicht sicher');
  });
});
