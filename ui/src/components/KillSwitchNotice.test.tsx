// SPDX-License-Identifier: GPL-3.0-only

// KillSwitchNotice.test.tsx — баннер «прокси сохранён» виден, только пока прокси
// действительно оставлен; «Снять прокси» возвращает прежние настройки.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { markSystemProxy } from '../lib/connection';
import { clearProxyKept, markProxyKept } from '../lib/killSwitch';
import { setLanguage, t } from '../lib/i18n';
import { click, mount, stubCore, unmountAll } from '../test-utils/coreStub';
import { KillSwitchNotice } from './KillSwitchNotice';

beforeEach(() => {
  setLanguage('en');
  stubCore({});
});

afterEach(() => {
  unmountAll();
  clearProxyKept();
  markSystemProxy(false);
  vi.unstubAllGlobals();
});

const notice = (c: HTMLElement): Element | null => c.querySelector('.banner-warn');

async function keep(): Promise<void> {
  await act(async () => {
    markProxyKept();
    await Promise.resolve();
  });
}

describe('KillSwitchNotice', () => {
  it('нет оставленного прокси — баннера нет', async () => {
    const view = await mount(createElement(KillSwitchNotice));
    expect(notice(view.container)).toBeNull();
  });

  it('прокси оставлен и применён — баннер с предупреждением и кнопкой', async () => {
    markSystemProxy(true);
    const view = await mount(createElement(KillSwitchNotice));
    await keep();
    expect(notice(view.container)?.textContent).toContain(t('kill.banner.t'));
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('флаг есть, но прокси уже снят — баннера нет', async () => {
    const view = await mount(createElement(KillSwitchNotice));
    await keep();
    expect(notice(view.container)).toBeNull();
  });

  it('«Снять прокси» гасит баннер (вне оболочки это только пометка «не применён»)', async () => {
    markSystemProxy(true);
    const view = await mount(createElement(KillSwitchNotice));
    await keep();
    const release = Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent === t('kill.release'));
    await click(release);
    expect(notice(view.container)).toBeNull();
  });
});
