// SPDX-License-Identifier: GPL-3.0-only

// NekoBoxTile.test.tsx — плитка онбординга передаёт «перенос выполнен» наружу
// (T-78): онбординг по этому сигналу открывает список серверов.
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../../lib/i18n';
import { flush, mount, stubCore, unmountAll } from '../../test-utils/coreStub';
import { NekoBoxTile } from './NekoBoxTile';

const REPORT = { groupsImported: 1, profilesByType: { vless: 2 }, routesFound: 0 };

beforeEach(() => {
  setLanguage('en');
});
afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function click(el: Element | null | undefined): Promise<void> {
  await act(async () => {
    (el as HTMLElement | null | undefined)?.click();
    await Promise.resolve();
  });
  await flush(20);
}

const dialogButton = (label: string): Element | undefined =>
  Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => (b.textContent ?? '').trim() === label);

describe('NekoBoxTile (T-78)', () => {
  it('onImported вызывается один раз после успешного переноса, не после предпросмотра', async () => {
    stubCore({
      'MigrationService/DetectNekoBox': { candidates: [] },
      'MigrationService/PreviewNekoBoxImport': { ...REPORT, dryRun: true },
      'MigrationService/ImportNekoBox': REPORT,
    });
    const onImported = vi.fn();
    await mount(createElement(NekoBoxTile, { onImported }));
    await click(document.querySelector('.onb-src'));
    const input = document.querySelector<HTMLInputElement>('#nbPath');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    act(() => {
      descriptor?.set?.call(input, 'C:/neko/config');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(dialogButton(t('nb.preview')));
    expect(onImported).not.toHaveBeenCalled();
    await click(dialogButton(t('nb.import')));
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('по умолчанию после переноса открывается список серверов', async () => {
    stubCore({
      'MigrationService/DetectNekoBox': { candidates: [] },
      'MigrationService/PreviewNekoBoxImport': { ...REPORT, dryRun: true },
      'MigrationService/ImportNekoBox': REPORT,
    });
    window.location.hash = '#screen=connection';
    await mount(createElement(NekoBoxTile));
    await click(document.querySelector('.onb-src'));
    const input = document.querySelector<HTMLInputElement>('#nbPath');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    act(() => {
      descriptor?.set?.call(input, 'C:/neko/config');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(dialogButton(t('nb.preview')));
    expect(window.location.hash).toBe('#screen=connection');
    await click(dialogButton(t('nb.import')));
    expect(window.location.hash).toBe('#screen=servers&tab=profiles');
  });
});
