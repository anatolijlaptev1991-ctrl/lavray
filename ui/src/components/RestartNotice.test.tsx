// SPDX-License-Identifier: GPL-3.0-only

// RestartNotice.test.tsx — общий баннер «Перезапустить ядро» для любого ответа
// ядра с needs_profile_restart (хвосты B, 7.1).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { setLanguage, t } from '../lib/i18n';
import { clearRestartNeeded, markRestartNeeded } from '../lib/restartNeeded';
import { Failure, click, mount, stubCore, unmountAll } from '../test-utils/coreStub';
import { RestartNotice } from './RestartNotice';

beforeEach(() => {
  setLanguage('en');
});

afterEach(() => {
  unmountAll();
  clearRestartNeeded();
  vi.unstubAllGlobals();
});

const banner = (c: HTMLElement): Element | null => c.querySelector('.restart-banner');
const button = (c: HTMLElement, key: 'dns.restartBtn' | 'dns.restartLater'): HTMLElement | undefined =>
  Array.from(c.querySelectorAll<HTMLElement>('button')).find((b) => b.textContent?.includes(t(key)));

async function raise(): Promise<void> {
  await act(async () => {
    markRestartNeeded();
    await Promise.resolve();
  });
}

describe('RestartNotice', () => {
  it('без флага баннера нет, с флагом — есть', async () => {
    stubCore({});
    const view = await mount(createElement(RestartNotice));
    expect(banner(view.container)).toBeNull();
    await raise();
    expect(banner(view.container)?.textContent).toContain(t('dns.restart'));
  });

  it('«Перезапустить» вызывает RestartProfile один раз и прячет баннер после успеха', async () => {
    const core = stubCore({ 'CoreService/RestartProfile': {} });
    const view = await mount(createElement(RestartNotice));
    await raise();
    await click(button(view.container, 'dns.restartBtn'));
    expect(core.bodies('CoreService/RestartProfile')).toHaveLength(1);
    expect(banner(view.container)).toBeNull();
  });

  it('«Позже» прячет баннер и ничего не вызывает', async () => {
    const core = stubCore({});
    const view = await mount(createElement(RestartNotice));
    await raise();
    await click(button(view.container, 'dns.restartLater'));
    expect(banner(view.container)).toBeNull();
    expect(core.bodies('CoreService/RestartProfile')).toHaveLength(0);
  });

  it('отказ ядра: баннер остаётся и показывает ошибку (R)', async () => {
    stubCore({ 'CoreService/RestartProfile': new Failure('failed_precondition', 'нет активного соединения') });
    const view = await mount(createElement(RestartNotice));
    await raise();
    await click(button(view.container, 'dns.restartBtn'));
    expect(banner(view.container)).not.toBeNull();
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('флаг, поднятый до монтирования, виден сразу (баннер не привязан к экрану)', async () => {
    stubCore({});
    markRestartNeeded();
    const view = await mount(createElement(RestartNotice));
    expect(banner(view.container)).not.toBeNull();
  });
});
