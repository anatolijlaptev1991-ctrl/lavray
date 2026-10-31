// SPDX-License-Identifier: GPL-3.0-only

// BackupDialogs.test.tsx — диалоги резервной копии (T-83): создание с паролем и
// сохранением через оболочку, восстановление «файл → пароль → сводка →
// подтверждение → замена → перезагрузка».
import { create } from '@bufbuild/protobuf';
import { Code } from '@connectrpc/connect';
import { createElement, act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BackupSummarySchema,
  ExportBackupResponseSchema,
  ImportBackupResponseSchema,
  type BackupSummary,
} from '../../gen/lavray_pb';
import { CoreContext } from '../../hooks/useCore';
import type { CoreClients } from '../../lib/core';
import { setLanguage, t, tf } from '../../lib/i18n';
import { coreError } from '../../test-utils/coreError';
import { BackupExportDialog } from './BackupExportDialog';
import { BackupRestoreDialog } from './BackupRestoreDialog';

const saveFileMock = vi.hoisted(() => vi.fn<(name: string, ext: string, data: Uint8Array) => Promise<string>>());
vi.mock('../../lib/saveFile', () => ({ saveFile: saveFileMock }));

const SUMMARY: BackupSummary = create(BackupSummarySchema, {
  groups: 3,
  profiles: 42,
  subscriptions: 2,
  presets: 1,
  settings: 17,
  appVersion: '0.7.0',
  schemaVersion: 5n,
  createdAtMs: 1_790_000_000_000n,
});
const FILE_BYTES = Uint8Array.from([0x4c, 0x41, 0x56, 0x42, 0x4b, 0x31, 9, 8, 7]);

interface Stub {
  exportBackup: ReturnType<typeof vi.fn>;
  previewBackup: ReturnType<typeof vi.fn>;
  importBackup: ReturnType<typeof vi.fn>;
}

let stub: Stub;
let unmount: (() => void) | undefined;

function mount(node: ReactElement): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const clients = { backup: stub } as unknown as CoreClients;
  act(() => {
    root.render(createElement(CoreContext.Provider, { value: clients }, node));
  });
  unmount = (): void => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function setValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  act(() => {
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function byId(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`#${id} не найден`);
  return el as HTMLInputElement;
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
    (b) => (b.textContent ?? '').trim() === label,
  );
  if (found === undefined) throw new Error(`кнопка «${label}» не найдена`);
  return found;
}

function click(el: HTMLElement): void {
  act(() => {
    el.click();
  });
}

const alertText = (): string => document.querySelector('[role="alert"]')?.textContent ?? '';

beforeEach(() => {
  setLanguage('en');
  saveFileMock.mockReset();
  stub = {
    exportBackup: vi.fn(() =>
      Promise.resolve(
        create(ExportBackupResponseSchema, { data: FILE_BYTES, suggestedName: 'lavray-backup-20261031-120000.lavbk', summary: SUMMARY }),
      ),
    ),
    previewBackup: vi.fn(() => Promise.resolve(SUMMARY)),
    importBackup: vi.fn(() => Promise.resolve(create(ImportBackupResponseSchema, { restored: SUMMARY }))),
  };
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

describe('BackupExportDialog', () => {
  const GOOD = 'correct horse';

  function open(onSaved = vi.fn(), onClose = vi.fn()): { onSaved: typeof onSaved; onClose: typeof onClose } {
    mount(createElement(BackupExportDialog, { onSaved, onClose }));
    return { onSaved, onClose };
  }
  const fill = (a: string, b: string, ack = true): void => {
    setValue(byId('bkPw'), a);
    setValue(byId('bkPw2'), b);
    if (ack) click(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  };

  it('backup_dialog_requires_matching_passwords', () => {
    open();
    fill(GOOD, 'different horse');
    expect(alertText()).toBe(t('bk.mismatch'));
    expect(button(t('bk.save')).disabled).toBe(true);
    click(button(t('bk.save')));
    expect(stub.exportBackup).not.toHaveBeenCalled();
    setValue(byId('bkPw2'), GOOD);
    expect(alertText()).toBe('');
    expect(button(t('bk.save')).disabled).toBe(false);
  });

  it('min_length_enforced', () => {
    open();
    fill('1234567', '1234567');
    expect(document.getElementById('bkPwHint')?.textContent).toBe(tf('bk.pwShort', { n: 8 }));
    expect(button(t('bk.save')).disabled).toBe(true);
    setValue(byId('bkPw'), '12345678');
    setValue(byId('bkPw2'), '12345678');
    expect(button(t('bk.save')).disabled).toBe(false);
  });

  it('forgotten_password_warning_required', () => {
    open();
    fill(GOOD, GOOD, false);
    expect(button(t('bk.save')).disabled).toBe(true);
    click(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(button(t('bk.save')).disabled).toBe(false);
  });

  it('save_binary_via_adapter', async () => {
    saveFileMock.mockResolvedValue('saved');
    const { onSaved } = open();
    fill(GOOD, GOOD);
    click(button(t('bk.save')));
    await settle();
    expect(stub.exportBackup).toHaveBeenCalledWith({ password: GOOD });
    expect(saveFileMock).toHaveBeenCalledTimes(1);
    const [name, ext, data] = saveFileMock.mock.calls[0] ?? [];
    expect(name).toBe('lavray-backup-20261031-120000');
    expect(ext).toBe('lavbk');
    expect(Array.from(data ?? [])).toEqual(Array.from(FILE_BYTES));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('отмена в системном диалоге оставляет окно открытым без ошибки', async () => {
    saveFileMock.mockResolvedValue('cancelled');
    const { onSaved } = open();
    fill(GOOD, GOOD);
    click(button(t('bk.save')));
    await settle();
    expect(onSaved).not.toHaveBeenCalled();
    expect(alertText()).toBe('');
    expect(button(t('bk.save')).disabled).toBe(false);
  });

  it('password_nfc_normalized', async () => {
    saveFileMock.mockResolvedValue('saved');
    open();
    fill('café-пароль', 'café-пароль'); // разные формы одного текста совпадают
    expect(alertText()).toBe('');
    click(button(t('bk.save')));
    await settle();
    expect(stub.exportBackup).toHaveBeenCalledWith({ password: 'café-пароль' });
  });

  it('a11y: поля подписаны, пароль не подсказывается браузером, ошибка объявляется role=alert', () => {
    open();
    for (const id of ['bkPw', 'bkPw2']) {
      const input = byId(id);
      expect(document.querySelector(`label[for="${id}"]`), `label для ${id}`).not.toBeNull();
      expect(input.type).toBe('password');
      expect(input.autocomplete).toBe('new-password');
    }
    expect(document.querySelector('input[type="checkbox"]')?.closest('label')?.textContent).toBe(t('bk.ack'));
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe('bkExpTitle');
    fill(GOOD, 'x');
    expect(byId('bkPw2').getAttribute('aria-invalid')).toBe('true');
    expect(byId('bkPw2').getAttribute('aria-describedby')).toBe('bkPwMismatch');
    expect(document.getElementById('bkPwMismatch')?.getAttribute('role')).toBe('alert');
  });

  it('ошибка ядра и сбой сохранения показываются понятным текстом', async () => {
    stub.exportBackup.mockRejectedValueOnce(coreError(Code.Aborted, 'backup_busy'));
    open();
    fill(GOOD, GOOD);
    click(button(t('bk.save')));
    await settle();
    expect(alertText()).toBe(t('bk.err.busy'));
    saveFileMock.mockRejectedValueOnce(new Error('io:denied'));
    click(button(t('bk.save')));
    await settle();
    expect(alertText()).toBe(t('bk.err.save'));
  });
});

describe('BackupRestoreDialog', () => {
  const PW = 'correct horse';

  async function chooseFile(bytes: Uint8Array = FILE_BYTES, size?: number, name = 'my.lavbk'): Promise<void> {
    const input = byId('bkFile');
    const file = new File([bytes], name);
    if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // FileReader отвечает не мгновенно (под нагрузкой — через несколько тиков):
    // ждём, пока диалог покажет результат выбора — имя файла либо ошибку
    for (let i = 0; i < 100; i++) {
      await settle();
      const text = document.body.textContent ?? '';
      if (text.includes(name) || document.querySelector('[role="alert"]') !== null) return;
    }
  }

  function open(onRestored = vi.fn(), onClose = vi.fn()): { onRestored: typeof onRestored; onClose: typeof onClose } {
    mount(createElement(BackupRestoreDialog, { onRestored, onClose }));
    return { onRestored, onClose };
  }

  async function toSummary(): Promise<void> {
    await chooseFile();
    setValue(byId('bkRestPw'), PW);
    click(button(t('bk.check')));
    await settle();
  }

  it('restore_shows_summary_before_replace', async () => {
    open();
    expect(button(t('bk.check')).disabled).toBe(true); // нет файла и пароля
    await toSummary();
    expect(stub.previewBackup).toHaveBeenCalledTimes(1);
    const req = stub.previewBackup.mock.calls[0]?.[0] as { data: Uint8Array; password: string };
    expect(Array.from(req.data)).toEqual(Array.from(FILE_BYTES));
    expect(req.password).toBe(PW);
    // данные ещё не заменены, сводка показана
    expect(stub.importBackup).not.toHaveBeenCalled();
    const text = document.querySelector('[role="dialog"]')?.textContent ?? '';
    for (const part of ['42', '0.7.0', t('bk.sumProfiles'), t('bk.replaceWarn')]) expect(text).toContain(part);

    // опасное подтверждение: до него замены нет, отмена ничего не меняет
    click(button(t('bk.replaceBtn')));
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(2);
    expect(document.body.textContent).toContain(t('bk.confirmTitle'));
    click(button(t('common.cancel')));
    expect(stub.importBackup).not.toHaveBeenCalled();

    click(button(t('bk.replaceBtn')));
    click(button(t('bk.confirmOk')));
    await settle();
    expect(stub.importBackup).toHaveBeenCalledTimes(1);
    const imp = stub.importBackup.mock.calls[0]?.[0] as { password: string; confirmReplace: boolean };
    expect(imp.confirmReplace).toBe(true);
    expect(imp.password).toBe(PW);
  });

  it('restore_success_reloads', async () => {
    const { onRestored, onClose } = open();
    await toSummary();
    click(button(t('bk.replaceBtn')));
    click(button(t('bk.confirmOk')));
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(t('bk.done'));
    expect(onRestored).not.toHaveBeenCalled();
    click(button(t('bk.reload')));
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('закрытие окна после замены данных тоже перезагружает состояние', async () => {
    const { onRestored } = open();
    await toSummary();
    click(button(t('bk.replaceBtn')));
    click(button(t('bk.confirmOk')));
    await settle();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it('если ядро просит перезапуск приложения, это сказано в окне', async () => {
    stub.importBackup.mockResolvedValueOnce(create(ImportBackupResponseSchema, { restored: SUMMARY, needsAppRestart: true }));
    open();
    await toSummary();
    click(button(t('bk.replaceBtn')));
    click(button(t('bk.confirmOk')));
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(t('bk.doneRestart'));
  });

  it.each([
    ['restore_error_wrong_password', Code.PermissionDenied, 'backup_wrong_password', 'bk.err.wrongPassword'],
    ['restore_error_tampered', Code.DataLoss, 'backup_tampered', 'bk.err.tampered'],
    ['restore_error_newer_version', Code.FailedPrecondition, 'backup_from_newer_version', 'bk.err.newer'],
  ] as const)('%s', async (_name, code, reason, key) => {
    stub.previewBackup.mockRejectedValueOnce(coreError(code, reason));
    open();
    await toSummary();
    expect(alertText()).toBe(t(key));
    // остаёмся на форме: можно поправить пароль и повторить, замены нет
    expect(button(t('bk.check')).disabled).toBe(false);
    expect(document.body.textContent).not.toContain(t('bk.replaceBtn'));
    expect(stub.importBackup).not.toHaveBeenCalled();
  });

  it('ошибка замены (активное подключение) показана в сводке, данные не заменены', async () => {
    stub.importBackup.mockRejectedValueOnce(coreError(Code.FailedPrecondition, 'connection_active'));
    const { onRestored } = open();
    await toSummary();
    click(button(t('bk.replaceBtn')));
    click(button(t('bk.confirmOk')));
    await settle();
    expect(alertText()).toBe(t('bk.err.connected'));
    expect(onRestored).not.toHaveBeenCalled();
    expect(button(t('bk.replaceBtn')).disabled).toBe(false);
  });

  it('файл больше 64 МиБ отвергается без чтения и отправки', async () => {
    open();
    await chooseFile(FILE_BYTES, 64 * 1024 * 1024 + 1);
    expect(alertText()).toBe(t('bk.err.tooLarge'));
    expect(button(t('bk.check')).disabled).toBe(true);
  });

  it('смена файла или пароля после проверки возвращает на форму', async () => {
    open();
    await toSummary();
    expect(document.body.textContent).toContain(t('bk.replaceBtn'));
    await chooseFile(Uint8Array.from([1, 2, 3]), undefined, 'other.lavbk');
    expect(document.body.textContent).not.toContain(t('bk.replaceBtn'));
    expect(button(t('bk.check')).disabled).toBe(false);
  });
});
