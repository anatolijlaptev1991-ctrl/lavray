// SPDX-License-Identifier: GPL-3.0-only

// InstallFromFile.test.tsx — «Установить из файла» и «Откатиться» (T-75). Диалог
// выбора даёт оболочка (update_pick_installer), подпись проверяет ядро
// (VerifyLocalUpdate), установку и откат выполняет оболочка. Вне окна Tauri обе
// строки скрыты.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { setLanguage } from '../../lib/i18n';
import { Failure, click, flush, mount, stubCore, unmountAll, type CoreStub, type Json, type Route } from '../../test-utils/coreStub';
import { UpdatesScreen } from './UpdatesScreen';

vi.mock('@tauri-apps/api/core', async () => (await import('../../test-utils/tauriStub')).tauriCoreModule);
const { tauri, enableTauri, disableTauri } = await import('../../test-utils/tauriStub');

const SHA = 'f'.repeat(64);
const STATE = 'UpdateService/GetUpdateState';
const VERIFY = 'UpdateService/VerifyLocalUpdate';
const PICKED = { staged_path: 'C:\\data\\updates\\staging\\x-setup.exe', sha256: SHA };

function core(routes: Record<string, Route> = {}): CoreStub {
  return stubCore({ [STATE]: {}, 'SettingsService/GetSettings': { values: {} }, ...routes });
}
const buttons = (): HTMLButtonElement[] => Array.from(document.querySelectorAll('button'));
const btn = (label: string): HTMLButtonElement | null =>
  buttons().find((b) => (b.textContent ?? '').trim() === label) ?? null;
const fileBtn = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('#updFileRow .btn-sec')!;
const row = (id: string): string => document.querySelector(id)?.textContent ?? '';
const valid = (version = '1.3.0'): Json => ({ valid: true, manifest: { product: 'lavray-windows', version, serial: '4' } });

beforeEach(() => {
  setLanguage('en');
  tauri.reset();
  enableTauri();
});
afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  disableTauri();
});

describe('install_from_file_flow', () => {
  it('H: выбор → проверка ядром → версия → «Install now» → update_apply с данными манифеста', async () => {
    tauri.onValue('update_pick_installer', PICKED);
    tauri.onValue('update_apply', { status: 'installing' });
    const stub = core({ [VERIFY]: valid() });
    await mount(createElement(UpdatesScreen));
    await click(fileBtn());
    expect(stub.bodies(VERIFY)).toEqual([{ installerPath: PICKED.staged_path }]);
    expect(row('#updFileRow')).toContain('Installer verified, version 1.3.0.');
    const install = document.querySelector<HTMLButtonElement>('#updFileRow .btn-pri')!;
    await click(install);
    expect(tauri.argsOf('update_apply')).toEqual([
      { stagedPath: PICKED.staged_path, sha256: SHA, version: '1.3.0' },
    ]);
    expect(row('#updFileRow')).toContain('Installing the update');
  });

  it('E: диалог закрыт без выбора — ничего не проверяется', async () => {
    tauri.onValue('update_pick_installer', null);
    const stub = core({ [VERIFY]: valid() });
    await mount(createElement(UpdatesScreen));
    await click(fileBtn());
    expect(stub.bodies(VERIFY)).toEqual([]);
    expect(document.querySelector('#updFileRow [role="alert"]')).toBeNull();
    expect(document.querySelector('#updFileRow .btn-pri')).toBeNull();
  });

  it('I: файл не прошёл проверку — причины из ответа ядра, кнопки установки нет', async () => {
    tauri.onValue('update_pick_installer', PICKED);
    core({ [VERIFY]: { valid: false, errors: ['bad signature', 'older than installed'] } });
    await mount(createElement(UpdatesScreen));
    await click(fileBtn());
    const alert = document.querySelector('#updFileRow [role="alert"]')!;
    expect(alert.textContent).toContain('The installer didn’t pass verification.');
    expect(Array.from(alert.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'bad signature',
      'older than installed',
    ]);
    expect(document.querySelector('#updFileRow .btn-pri')).toBeNull();
    expect(tauri.argsOf('update_apply')).toHaveLength(0);
  });

  it('S: valid=true без манифеста — не принимается', async () => {
    tauri.onValue('update_pick_installer', PICKED);
    core({ [VERIFY]: { valid: true } });
    await mount(createElement(UpdatesScreen));
    await click(fileBtn());
    expect(document.querySelector('#updFileRow .btn-pri')).toBeNull();
  });

  it('S: путь вне staging (INVALID_ARGUMENT) — файл отклонён с понятным текстом', async () => {
    tauri.onValue('update_pick_installer', PICKED);
    core({ [VERIFY]: new Failure('invalid_argument', 'path outside staging') });
    await mount(createElement(UpdatesScreen));
    await click(fileBtn());
    expect(row('#updFileRow [role="alert"]')).toBe('The installer is outside the protected updates folder.');
    expect(document.querySelector('#updFileRow .btn-pri')).toBeNull();
  });

  it('R: ошибка выбора оболочкой (too_large) → локализованный текст', async () => {
    tauri.onError('update_pick_installer', 'too_large');
    core();
    await mount(createElement(UpdatesScreen));
    await click(fileBtn());
    expect(row('#updFileRow [role="alert"]')).toBe('The file is too large to be an installer.');
  });

  it('X: отказ в UAC при установке из файла — сообщение и возможность повторить', async () => {
    tauri.onValue('update_pick_installer', PICKED);
    tauri.onValue('update_apply', { status: 'uac_cancelled' });
    core({ [VERIFY]: valid() });
    await mount(createElement(UpdatesScreen));
    await click(fileBtn());
    await click(document.querySelector('#updFileRow .btn-pri'));
    expect(row('#updFileRow')).toContain('Installation cancelled');
    expect(document.querySelector('#updFileRow .btn-pri')).not.toBeNull();
  });

  it('C: двойной клик по «Install from file…» открывает один диалог', async () => {
    tauri.onValue('update_pick_installer', null);
    core();
    await mount(createElement(UpdatesScreen));
    const b = fileBtn();
    await act(async () => {
      b.click();
      b.click();
      await Promise.resolve();
    });
    await flush(30);
    expect(tauri.argsOf('update_pick_installer')).toHaveLength(1);
  });

  it('P: вне окна Tauri строки «из файла» нет', async () => {
    disableTauri();
    core();
    await mount(createElement(UpdatesScreen));
    expect(document.querySelector('#updFileRow')).toBeNull();
  });
});

describe('откат', () => {
  const withRollback = (extra: Json = {}): Json => ({
    components: [{ component: 'UPDATE_COMPONENT_APP', rollbackAvailable: true, previousVersion: '1.0.0', ...extra }],
  });

  it('строка есть только при rollback_available и называет версию', async () => {
    core({ [STATE]: withRollback() });
    await mount(createElement(UpdatesScreen));
    expect(row('#updRollbackRow')).toContain('Roll back to 1.0.0');
    unmountAll();
    core({ [STATE]: { components: [{ component: 'UPDATE_COMPONENT_APP', rollbackAvailable: false }] } });
    await mount(createElement(UpdatesScreen));
    expect(document.querySelector('#updRollbackRow')).toBeNull();
  });

  it('вне окна Tauri откат не предлагается', async () => {
    disableTauri();
    core({ [STATE]: withRollback() });
    await mount(createElement(UpdatesScreen));
    expect(document.querySelector('#updRollbackRow')).toBeNull();
  });

  it('подтверждение обязательно; «Cancel» не вызывает update_rollback; фокус на «Cancel»', async () => {
    tauri.onValue('update_rollback', { status: 'installing' });
    core({ [STATE]: withRollback() });
    await mount(createElement(UpdatesScreen));
    await click(document.querySelector('#updRollbackRow button'));
    const dlg = document.querySelector('[role="dialog"]')!;
    expect(dlg.textContent).toContain('Roll back to 1.0.0?');
    expect(document.activeElement?.textContent).toBe('Cancel');
    await click(btn('Cancel'));
    expect(tauri.argsOf('update_rollback')).toHaveLength(0);
  });

  it('подтверждение вызывает update_rollback и показывает «устанавливаю»', async () => {
    tauri.onValue('update_rollback', { status: 'installing' });
    core({ [STATE]: withRollback() });
    await mount(createElement(UpdatesScreen));
    await click(document.querySelector('#updRollbackRow button'));
    await click(Array.from(document.querySelectorAll('.dlg-f button')).find((b) => b.className.includes('btn-pri')));
    expect(tauri.argsOf('update_rollback')).toHaveLength(1);
    expect(row('#updRollbackRow')).toContain('Installing the update');
  });

  it('отказ в UAC и ошибка оболочки сообщаются', async () => {
    tauri.onValue('update_rollback', { status: 'uac_cancelled' });
    core({ [STATE]: withRollback() });
    await mount(createElement(UpdatesScreen));
    await click(document.querySelector('#updRollbackRow button'));
    await click(Array.from(document.querySelectorAll('.dlg-f button')).find((b) => b.className.includes('btn-pri')));
    expect(row('#updRollbackRow')).toContain('Installation cancelled');
    tauri.onError('update_rollback', 'rollback_unavailable');
    await click(document.querySelector('#updRollbackRow button'));
    await click(Array.from(document.querySelectorAll('.dlg-f button')).find((b) => b.className.includes('btn-pri')));
    expect(row('#updRollbackRow [role="alert"]')).toBe('There is no previous version to roll back to.');
  });
});
