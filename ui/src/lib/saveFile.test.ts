// SPDX-License-Identifier: GPL-3.0-only

// saveFile.test.ts — T-82: «Сохранить как» отдаёт оболочке байты сырым телом,
// имя и расширение — заголовками; отмена — не ошибка; в веб-панели — загрузка.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveFile } from './saveFile';

// Подставка tauriStub не передаёт третий аргумент invoke (заголовки): свой мок.
const invokeMock = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown, options?: unknown) => Promise<unknown>>());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

const lastCall = (): { cmd: string; body: unknown; headers: Record<string, string> } => {
  const [cmd, body, options] = invokeMock.mock.calls.at(-1) ?? [];
  return { cmd: cmd ?? '', body, headers: (options as { headers: Record<string, string> }).headers };
};

beforeEach(() => {
  invokeMock.mockReset();
  (window as TauriWindow).__TAURI_INTERNALS__ = {};
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as TauriWindow).__TAURI_INTERNALS__;
});

describe('saveFile (T-82)', () => {
  it('save_file_writes_binary_through_shell', async () => {
    invokeMock.mockResolvedValue(true);
    await expect(saveFile('копия', 'lavbk', new Uint8Array([0, 1, 254, 255]))).resolves.toBe('saved');
    const call = lastCall();
    expect(call.cmd).toBe('file_save');
    expect(Array.from(call.body as Uint8Array)).toEqual([0, 1, 254, 255]);
    expect(call.headers).toEqual({ 'x-lavray-name': encodeURIComponent('копия'), 'x-lavray-ext': 'lavbk' });
  });

  it('text_is_utf8', async () => {
    invokeMock.mockResolvedValue(true);
    await saveFile('log', 'txt', 'журнал');
    expect(new TextDecoder().decode(lastCall().body as Uint8Array)).toBe('журнал');
  });

  it('cancel_is_not_an_error', async () => {
    invokeMock.mockResolvedValue(false);
    await expect(saveFile('x', 'txt', '')).resolves.toBe('cancelled');
  });

  it('shell_error_code_is_the_message', async () => {
    invokeMock.mockRejectedValue('io:permissiondenied');
    await expect(saveFile('x', 'txt', 'a')).rejects.toThrow('io:permissiondenied');
  });

  it('web_fallback_uses_download', async () => {
    delete (window as TauriWindow).__TAURI_INTERNALS__;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const url = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: url, revokeObjectURL: vi.fn() });
    await expect(saveFile('lavray-log', 'txt', 'abc')).resolves.toBe('saved');
    expect(click).toHaveBeenCalledTimes(1);
    expect(url).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
