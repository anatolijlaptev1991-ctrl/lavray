// SPDX-License-Identifier: GPL-3.0-only

// QrDialog.test.tsx — QR-код профиля: холст с кодом, копирование ссылки,
// предупреждение о ключах, «слишком длинно», отсутствие ссылки, Esc.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { ExportLinksResponseSchema } from '../gen/lavray_pb';
import { setLanguage } from '../lib/i18n';
import { decodeQrFromPixels } from '../lib/qr/decode';
import { QR_MAX_BYTES } from '../lib/qr/encode';
import { buttonByText, click, flush, makeClients, mountWithCore, profileOf } from '../test-harness';
import type { Mounted } from '../test-harness';
import { installFakeImages } from '../test-utils/qrKit';
import type { FakeImages } from '../test-utils/qrKit';
import { qrPixels } from '../test-utils/qrKit';
import { QrDialog } from './QrDialog';

const LINK = 'vless://b831381d-6324-4d53-ad4f-8cda48b30811@example.org:443?security=reality&pbk=Zk#Frankfurt';
const writeText = vi.fn((_text: string) => Promise.resolve());
let fake: FakeImages;

beforeEach(() => {
  setLanguage('en');
  fake = installFakeImages(qrPixels(LINK));
  writeText.mockClear();
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  fake.restore();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

async function open(links: string[], onClose = vi.fn()): Promise<Mounted & { dialog: HTMLElement }> {
  const clients = makeClients();
  vi.spyOn(clients.profiles, 'exportLinks').mockResolvedValue(create(ExportLinksResponseSchema, { links }));
  const m = await mountWithCore(clients, createElement(QrDialog, { profile: profileOf(1, 'Frankfurt'), onClose }));
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog === null) throw new Error('диалог QR не открыт');
  return { ...m, dialog };
}

describe('QrDialog', () => {
  it('qr_dialog_shows_canvas_copies_link: холст с кодом ссылки, имя профиля, «Копировать ссылку»', async () => {
    const m = await open([LINK]);
    const canvas = m.dialog.querySelector<HTMLCanvasElement>('canvas[role="img"]');
    expect(canvas, 'холст с role=img').not.toBeNull();
    expect(canvas?.getAttribute('aria-label')).toBe('QR code for the link of “Frankfurt”');
    expect(m.dialog.textContent).toContain('Frankfurt');
    expect(m.dialog.getAttribute('aria-labelledby')).toBe('qrTitle');
    expect(m.dialog.querySelector('#qrTitle')?.textContent).toBe('Profile QR code');

    // то, что положено в холст, читается обратно в ту же ссылку
    const drawn = fake.puts[0];
    expect(drawn).toBeDefined();
    expect(decodeQrFromPixels(drawn?.px ?? new Uint8ClampedArray(), drawn?.w ?? 0, drawn?.h ?? 0)).toBe(LINK);

    await click(buttonByText(m.dialog, 'Copy link'));
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(m.dialog.querySelector('.toast-ok')?.textContent).toBe('Link copied to clipboard');
    m.unmount();
  });

  it('запрашивает ссылку именно этого профиля', async () => {
    const clients = makeClients();
    const spy = vi
      .spyOn(clients.profiles, 'exportLinks')
      .mockResolvedValue(create(ExportLinksResponseSchema, { links: [LINK] }));
    const m = await mountWithCore(clients, createElement(QrDialog, { profile: profileOf(7, 'S7'), onClose: vi.fn() }));
    expect(spy).toHaveBeenCalledWith({ ids: [7n] });
    m.unmount();
  });

  it('secret_warning_shown: ссылка с ключами — предупреждение; без ключей — нет', async () => {
    const withSecret = await open([LINK]);
    expect(withSecret.dialog.querySelector('.banner-warn')?.textContent).toContain('access keys');
    withSecret.unmount();
    document.body.innerHTML = '';

    const plain = await open(['socks5://127.0.0.1:1080#local']);
    expect(plain.dialog.querySelector('canvas')).not.toBeNull();
    expect(plain.dialog.querySelector('.banner-warn')).toBeNull();
    plain.unmount();
  });

  it('слишком длинная ссылка: сообщение вместо кода, но копировать можно', async () => {
    const long = `vless://${'a'.repeat(QR_MAX_BYTES + 10)}@example.org:443`;
    const m = await open([long]);
    expect(m.dialog.querySelector('canvas')).toBeNull();
    expect(m.dialog.textContent).toContain('too long for a QR code');
    await click(buttonByText(m.dialog, 'Copy link'));
    expect(writeText).toHaveBeenCalledWith(long);
    m.unmount();
  });

  it('у профиля нет ссылки (цепочка, custom): сообщение, копирование недоступно', async () => {
    const m = await open([]);
    expect(m.dialog.querySelector('canvas')).toBeNull();
    expect(m.dialog.querySelector('[role="alert"]')?.textContent).toBe('These servers have no shareable link');
    expect(buttonByText(m.dialog, 'Copy link').disabled).toBe(true);
    m.unmount();
  });

  it('ядро не ответило: сообщение об ошибке, а не пустой диалог', async () => {
    const clients = makeClients();
    vi.spyOn(clients.profiles, 'exportLinks').mockRejectedValue(new Error('Failed to fetch'));
    const m = await mountWithCore(clients, createElement(QrDialog, { profile: profileOf(1, 'S1'), onClose: vi.fn() }));
    expect(document.querySelector('[role="alert"]')?.textContent ?? '').not.toBe('');
    expect(document.querySelector('canvas')).toBeNull();
    m.unmount();
  });

  it('Esc и «Close» закрывают диалог', async () => {
    const onClose = vi.fn();
    const m = await open([LINK], onClose);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await click(buttonByText(m.dialog, 'Close'));
    expect(onClose).toHaveBeenCalledTimes(2);
    await flush(1);
    m.unmount();
  });

  it('Tab не уходит из диалога (ловушка фокуса useModal)', async () => {
    const m = await open([LINK]);
    const copy = buttonByText(m.dialog, 'Copy link');
    act(() => {
      copy.focus();
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(m.dialog.contains(document.activeElement)).toBe(true);
    m.unmount();
  });
});
