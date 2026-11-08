// SPDX-License-Identifier: GPL-3.0-only

// Импорт файла: размер проверяется до file.text(); слишком большой файл не
// читается, пользователь видит понятную ошибку.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CoreContext } from '../hooks/useCore';
import { createCoreClients } from '../lib/core';
import { MAX_IMPORT_FILE_BYTES } from '../lib/importFileGuard';
import { setLanguage } from '../lib/i18n';
import { ImportDialog } from './ImportDialog';

describe('ImportDialog: размер файла', () => {
  let root: Root;
  let container: HTMLDivElement;
  const clients = createCoreClients('http://127.0.0.1:1');

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setLanguage('en');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        createElement(
          CoreContext.Provider,
          { value: clients },
          createElement(ImportDialog, { groupId: 1n, onClose: vi.fn(), onImported: vi.fn() }),
        ),
      );
    });
  });
  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    vi.restoreAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function pick(file: File): Promise<void> {
    const tab = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).at(2);
    act(() => { tab?.click(); });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => {
      input?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
  }

  it('файл больше лимита: file.text() не вызывается, запроса нет, ошибка понятная', async () => {
    const importContent = vi.spyOn(clients.profiles, 'importContent');
    const file = new File(['x'], 'big.txt');
    Object.defineProperty(file, 'size', { value: MAX_IMPORT_FILE_BYTES + 1 });
    const text = vi.fn(() => Promise.resolve('x'));
    Object.defineProperty(file, 'text', { value: text }); // в jsdom File.text() нет
    await pick(file);
    expect(text).not.toHaveBeenCalled();
    expect(importContent).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('too large');
    expect(document.body.textContent).toContain('16');
  });

  it('файл ровно в лимит читается', async () => {
    vi.spyOn(clients.profiles, 'importContent').mockRejectedValue(new Error('stop'));
    const file = new File(['vless://x'], 'ok.txt');
    Object.defineProperty(file, 'size', { value: MAX_IMPORT_FILE_BYTES });
    const text = vi.fn(() => Promise.resolve('vless://x'));
    Object.defineProperty(file, 'text', { value: text });
    await pick(file);
    expect(text).toHaveBeenCalledTimes(1);
  });
});
