// SPDX-License-Identifier: GPL-3.0-only

// screen_servers.qr.test.tsx — QR-код на экране «Серверы»: пункт меню строки
// и Ctrl+Q для единственного отмеченного сервера (не срабатывает при наборе текста).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { ExportLinksResponseSchema } from '../gen/lavray_pb';
import type { CoreClients } from '../lib/core';
import { setLanguage } from '../lib/i18n';
import { buttonByText, click, flush, makeClients, mountWithCore, profileOf } from '../test-harness';
import type { Mounted } from '../test-harness';
import { installFakeImages, qrPixels } from '../test-utils/qrKit';
import type { FakeImages } from '../test-utils/qrKit';
import { ServersScreen } from './screen_servers';

const LINK = 'vless://b831381d-6324-4d53-ad4f-8cda48b30811@s2.example.org:443#S2';
let fake: FakeImages;

beforeEach(() => {
  setLanguage('en');
  window.localStorage.clear();
  fake = installFakeImages(qrPixels(LINK));
});
afterEach(() => {
  fake.restore();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

interface Screen extends Mounted {
  readonly exportLinks: MockInstance<CoreClients['profiles']['exportLinks']>;
}

async function mountServers(): Promise<Screen> {
  const clients = makeClients({ profiles: [profileOf(1, 'S1'), profileOf(2, 'S2'), profileOf(3, 'S3')] });
  const exportLinks = vi
    .spyOn(clients.profiles, 'exportLinks')
    .mockResolvedValue(create(ExportLinksResponseSchema, { links: [LINK] }));
  const m = await mountWithCore(clients, createElement(ServersScreen));
  return { ...m, exportLinks };
}

const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]');
const checkbox = (c: HTMLElement, name: string): HTMLInputElement | null =>
  c.querySelector<HTMLInputElement>(`input[aria-label="Select ${name}"]`);

async function ctrlQ(target: EventTarget, init: KeyboardEventInit = {}): Promise<void> {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', ctrlKey: true, bubbles: true, cancelable: true, ...init }),
    );
  });
  await flush(30);
}

describe('пункт «Show QR code» в меню строки', () => {
  it('открывает QR-код именно той строки, чьё меню открыто', async () => {
    const t = await mountServers();
    await click(t.container.querySelectorAll('.prow-more')[1]); // меню S2
    const menu = t.container.querySelector<HTMLElement>('[role="menu"]');
    if (menu === null) throw new Error('меню строки не открылось');
    await click(buttonByText(menu, 'Show QR code'));
    expect(t.container.querySelector('[role="menu"]'), 'меню закрылось').toBeNull();
    expect(t.exportLinks).toHaveBeenCalledWith({ ids: [2n] });
    expect(dialog()?.querySelector('canvas[role="img"]')).not.toBeNull();
    expect(dialog()?.textContent).toContain('S2');
    t.unmount();
  });
});

describe('Ctrl+Q', () => {
  it('ctrl_q_opens_for_selected_row: отмечен один сервер — открывается его QR-код', async () => {
    const t = await mountServers();
    await click(checkbox(t.container, 'S2'));
    expect(dialog()).toBeNull();
    await ctrlQ(window);
    expect(t.exportLinks).toHaveBeenCalledWith({ ids: [2n] });
    expect(dialog()?.querySelector('canvas[role="img"]')).not.toBeNull();
    t.unmount();
  });

  it('работает, когда фокус на самой галочке строки (это не набор текста)', async () => {
    const t = await mountServers();
    const box = checkbox(t.container, 'S3');
    await click(box);
    act(() => {
      box?.focus();
    });
    await ctrlQ(box ?? window);
    expect(t.exportLinks).toHaveBeenCalledWith({ ids: [3n] });
    t.unmount();
  });

  it('работает на русской раскладке: «й» на физической KeyQ', async () => {
    const t = await mountServers();
    await click(checkbox(t.container, 'S1'));
    await ctrlQ(window, { key: 'й' });
    expect(t.exportLinks).toHaveBeenCalledWith({ ids: [1n] });
    t.unmount();
  });

  it('ctrl_q_ignored_while_typing: фокус в поле поиска — ничего не открывается', async () => {
    const t = await mountServers();
    await click(checkbox(t.container, 'S2'));
    const search = t.container.querySelector<HTMLInputElement>('#profSearch');
    act(() => {
      search?.focus();
    });
    const ev = new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      search?.dispatchEvent(ev);
    });
    await flush(30);
    expect(ev.defaultPrevented, 'сочетание не перехвачено').toBe(false);
    expect(t.exportLinks).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    t.unmount();
  });

  it('ничего не отмечено или отмечено больше одного: подсказка, диалога нет', async () => {
    const t = await mountServers();
    await ctrlQ(window);
    expect(t.container.querySelector('[role="alert"]')?.textContent).toContain('tick exactly one server');
    await click(checkbox(t.container, 'S1'));
    await click(checkbox(t.container, 'S2'));
    await ctrlQ(window);
    expect(dialog()).toBeNull();
    expect(t.exportLinks).not.toHaveBeenCalled();
    t.unmount();
  });

  it('без Ctrl, с Alt или с Shift сочетание не срабатывает', async () => {
    const t = await mountServers();
    await click(checkbox(t.container, 'S2'));
    await ctrlQ(window, { ctrlKey: false });
    await ctrlQ(window, { altKey: true });
    await ctrlQ(window, { shiftKey: true });
    expect(dialog()).toBeNull();
    expect(t.exportLinks).not.toHaveBeenCalled();
    t.unmount();
  });
});
