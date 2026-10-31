// SPDX-License-Identifier: GPL-3.0-only

// QrTab.test.tsx — вкладка «QR-код» диалога импорта: файл, вставка из буфера,
// снимок экрана (только в Tauri). Распознанная ссылка идёт в обычный импорт.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, createElement } from 'react';
import { create } from '@bufbuild/protobuf';
import { ImportContentResponseSchema } from '../../gen/lavray_pb';
import type { CoreClients } from '../../lib/core';
import { setLanguage } from '../../lib/i18n';
import { CAPTURE_COMMAND } from '../../lib/qr/captureScreen';
import { click, flush, makeClients, mountWithCore, profileOf } from '../../test-harness';
import type { Mounted } from '../../test-harness';
import { blankPixels, capturePayloadOf, installFakeImages, pasteEvent, qrPixels } from '../../test-utils/qrKit';
import type { FakeImages } from '../../test-utils/qrKit';
import { enableTauri, tauri } from '../../test-utils/tauriStub';
import { ImportDialog } from '../ImportDialog';

vi.mock('@tauri-apps/api/core', async () => (await import('../../test-utils/tauriStub')).tauriCoreModule);

const LINK = 'vless://b831381d-6324-4d53-ad4f-8cda48b30811@qr.example.org:443?security=tls#QR1';
const SETTLE = 120;
let fake: FakeImages;

beforeEach(() => {
  setLanguage('en');
  tauri.reset();
});
afterEach(() => {
  fake.restore();
  tauri.reset();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

interface Dialog extends Mounted {
  readonly importContent: MockInstance<CoreClients['profiles']['importContent']>;
}

/** Диалог импорта на вкладке QR; на картинке — код ссылки LINK либо пустой лист. */
async function openQrTab(withCode = true): Promise<Dialog> {
  fake = installFakeImages(withCode ? qrPixels(LINK) : blankPixels(200, 200));
  const clients = makeClients();
  const importContent = vi
    .spyOn(clients.profiles, 'importContent')
    .mockImplementation((req) =>
      Promise.resolve(
        req.previewOnly === true
          ? create(ImportContentResponseSchema, { parsedProfiles: [profileOf(0, 'QR1')] })
          : create(ImportContentResponseSchema, { addedProfileIds: [101n] }),
      ),
    );
  const m = await mountWithCore(
    clients,
    createElement(ImportDialog, { groupId: 1n, initialTab: 'qr', onClose: vi.fn(), onImported: vi.fn() }),
  );
  return { ...m, importContent };
}

const pane = (): HTMLElement | null => document.getElementById('impPane-qr');
const fileInput = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('input[type="file"]');
const problem = (): string => pane()?.querySelector('[role="alert"]')?.textContent ?? '';
const tabSelected = (id: string): string | null => document.getElementById(id)?.getAttribute('aria-selected') ?? null;
const imageFile = (): File => new File([new Uint8Array([137, 80, 78, 71])], 'qr.png', { type: 'image/png' });

async function pick(file: File): Promise<void> {
  const input = fileInput();
  if (input === null) throw new Error('поле выбора файла не найдено');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush(SETTLE);
}

async function paste(event: Event): Promise<void> {
  act(() => {
    document.dispatchEvent(event);
  });
  await flush(SETTLE);
}

describe('вкладка QR: файл', () => {
  it('qr_file_fills_link_and_previews: ссылка из кода попадает на вкладку «Link» и идёт в предпросмотр', async () => {
    const m = await openQrTab();
    await pick(imageFile());
    expect(tabSelected('impTab-link')).toBe('true');
    expect(document.querySelector<HTMLInputElement>('#impLink')?.value).toBe(LINK);
    expect(m.importContent).toHaveBeenCalledWith({ content: LINK, previewOnly: true });
    expect(document.querySelector('.imp-prev-list')?.textContent).toContain('QR1');
    expect(fake.bitmaps.length).toBeGreaterThan(0);
    m.unmount();
  });

  it('qr_not_found_message: на картинке нет кода — сообщение, вкладка и импорт не меняются', async () => {
    const m = await openQrTab(false);
    await pick(imageFile());
    expect(problem()).toContain('No QR code found in the image');
    expect(tabSelected('impTab-qr')).toBe('true');
    expect(m.importContent).not.toHaveBeenCalled();
    m.unmount();
  });

  it('qr_tab_has_no_prototype_toast: ни «это прототип», ни ошибки-заглушки', async () => {
    const m = await openQrTab(false);
    await pick(imageFile());
    expect(document.body.textContent).not.toContain('prototype');
    const sources = import.meta.glob<string>(['../ImportDialog.tsx', './*.{ts,tsx}', '!./*.test.tsx'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4);
    for (const [file, text] of Object.entries(sources)) {
      expect(text, file).not.toContain('toast.window');
    }
    m.unmount();
  });

});

describe('вкладка QR: сбои чтения', () => {
  it('картинку не удалось прочитать (createImageBitmap отказал) — своё сообщение, а не «кода нет»', async () => {
    const m = await openQrTab();
    vi.mocked(globalThis.createImageBitmap).mockRejectedValueOnce(new Error('not an image'));
    await pick(imageFile());
    expect(problem()).toBe('Could not read the image');
    m.unmount();
  });

  it('тот же файл можно выбрать повторно: значение поля сбрасывается после чтения', async () => {
    const m = await openQrTab(false);
    const input = fileInput();
    expect(input).not.toBeNull();
    const set = vi.spyOn(input!, 'value', 'set');
    await pick(imageFile());
    expect(set).toHaveBeenCalledWith('');
    m.unmount();
  });
});

describe('вкладка QR: вставка из буфера', () => {
  it('paste_image_handled: картинка из буфера распознаётся и идёт в предпросмотр', async () => {
    const m = await openQrTab();
    const event = pasteEvent([imageFile()]);
    await paste(event);
    expect(event.defaultPrevented).toBe(true);
    expect(m.importContent).toHaveBeenCalledWith({ content: LINK, previewOnly: true });
    expect(tabSelected('impTab-link')).toBe('true');
    m.unmount();
  });

  it('paste_text_ignored_on_qr_tab: вставленный текст не трогается и не импортируется', async () => {
    const m = await openQrTab();
    const event = pasteEvent([], LINK);
    await paste(event);
    expect(event.defaultPrevented).toBe(false);
    expect(m.importContent).not.toHaveBeenCalled();
    expect(fake.bitmaps).toEqual([]);
    expect(tabSelected('impTab-qr')).toBe('true');
    expect(problem()).toBe('');
    m.unmount();
  });

  it('файл не-картинка в буфере игнорируется', async () => {
    const m = await openQrTab();
    await paste(pasteEvent([new File(['x'], 'a.txt', { type: 'text/plain' })]));
    expect(fake.bitmaps).toEqual([]);
    expect(m.importContent).not.toHaveBeenCalled();
    m.unmount();
  });

  it('на других вкладках вставка картинки не обрабатывается (слушатель снят)', async () => {
    const m = await openQrTab();
    await click(document.getElementById('impTab-file'));
    await paste(pasteEvent([imageFile()]));
    expect(fake.bitmaps).toEqual([]);
    expect(m.importContent).not.toHaveBeenCalled();
    m.unmount();
  });
});

describe('вкладка QR: снимок экрана', () => {
  const screenButton = (): HTMLButtonElement | undefined =>
    Array.from(pane()?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Capture the screen');

  it('scan_button_only_in_tauri: в браузере кнопки нет, в окне Tauri есть', async () => {
    const web = await openQrTab();
    expect(screenButton()).toBeUndefined();
    web.unmount();
    fake.restore();

    enableTauri();
    const native = await openQrTab();
    expect(screenButton()).toBeDefined();
    native.unmount();
  });

  it('scan_calls_capture_and_decodes: invoke(qr_capture_screen) → сырой ArrayBuffer → ссылка в предпросмотр', async () => {
    enableTauri();
    const frame = qrPixels(LINK);
    tauri.onRaw(CAPTURE_COMMAND, capturePayloadOf(frame));
    const m = await openQrTab();
    await click(screenButton());
    await flush(SETTLE);
    expect(tauri.calls).toEqual([{ cmd: 'qr_capture_screen', args: undefined }]);
    expect(m.importContent).toHaveBeenCalledWith({ content: LINK, previewOnly: true });
    expect(tabSelected('impTab-link')).toBe('true');
    m.unmount();
  });

  it('на снимке нет кода — «не найден»; отказ оболочки и неверный ответ — «не удалось снять»', async () => {
    enableTauri();
    tauri.onRaw(CAPTURE_COMMAND, capturePayloadOf(blankPixels(40, 40)));
    const m = await openQrTab(false);
    await click(screenButton());
    await flush(SETTLE);
    expect(problem()).toContain('No QR code found');

    tauri.onError(CAPTURE_COMMAND, 'экран недоступен');
    await click(screenButton());
    await flush(SETTLE);
    expect(problem()).toBe('Could not capture the screen: экран недоступен');

    tauri.onRaw(CAPTURE_COMMAND, new Uint8Array([1, 2, 3]));
    await click(screenButton());
    await flush(SETTLE);
    expect(problem()).toBe('Could not capture the screen');
    expect(m.importContent).not.toHaveBeenCalled();
    m.unmount();
  });
});

describe('вкладка QR: клавиатура', () => {
  it('file_input_keyboard_accessible: поле файла в порядке Tab, внутри подписанной кнопки-метки', async () => {
    const m = await openQrTab();
    const input = fileInput();
    expect(input).not.toBeNull();
    if (input === null) return;
    expect(input.getAttribute('style') ?? '').not.toContain('display');
    expect(input.classList.contains('sr-only')).toBe(true);
    expect(input.tabIndex).toBeGreaterThanOrEqual(0);
    expect(input.disabled).toBe(false);
    // метка — прямой родитель (CSS label:has(> input[type=file]:focus-visible) рисует кольцо фокуса)
    expect(input.parentElement?.tagName).toBe('LABEL');
    expect(input.parentElement?.textContent).toBe('Choose an image…');
    act(() => {
      input.focus();
    });
    expect(document.activeElement).toBe(input);
    m.unmount();
  });

  it('подсказка называет сочетание вставки для ОС окна', async () => {
    const m = await openQrTab();
    expect(pane()?.querySelector('.t2')?.textContent).toMatch(/clipboard \((Ctrl\+V|⌘V)\)/);
    m.unmount();
  });
});
