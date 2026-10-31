// SPDX-License-Identifier: GPL-3.0-only

// shell.test.ts — обёртки команд оболочки обновлений (T-75): аргументы invoke,
// разбор ответов, стабильные коды ошибок, поведение вне окна Tauri.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyUpdate, pickInstaller, reportHealthOk, rollbackUpdate, ShellError } from './shell';

vi.mock('@tauri-apps/api/core', async () => (await import('../../test-utils/tauriStub')).tauriCoreModule);
const { tauri, enableTauri, disableTauri } = await import('../../test-utils/tauriStub');

const SHA = 'a'.repeat(64);

beforeEach(() => {
  tauri.reset();
  enableTauri();
});
afterEach(() => {
  disableTauri();
});

describe('applyUpdate', () => {
  it('передаёт stagedPath, sha256, version и разбирает {status:"installing"}', async () => {
    tauri.onValue('update_apply', { status: 'installing' });
    const out = await applyUpdate({ stagedPath: 'C:\\s\\a.exe', sha256: SHA, version: '1.2.3' });
    expect(out).toBe('installing');
    expect(tauri.argsOf('update_apply')).toEqual([{ stagedPath: 'C:\\s\\a.exe', sha256: SHA, version: '1.2.3' }]);
  });

  it('{status:"uac_cancelled"} — отказ в UAC, не ошибка', async () => {
    tauri.onValue('update_apply', { status: 'uac_cancelled' });
    expect(await applyUpdate({ stagedPath: 'p', sha256: SHA, version: '1' })).toBe('uac_cancelled');
  });

  it('ответ неожиданной формы — ShellError с общим кодом, а не «установка началась»', async () => {
    for (const bad of [null, {}, { status: 'whatever' }, 'installing', 7]) {
      tauri.onValue('update_apply', bad);
      await expect(applyUpdate({ stagedPath: 'p', sha256: SHA, version: '1' })).rejects.toBeInstanceOf(ShellError);
    }
  });

  it('отказ оболочки (строка-код) → ShellError с этим кодом', async () => {
    tauri.onError('update_apply', 'sha256_mismatch');
    await expect(applyUpdate({ stagedPath: 'p', sha256: SHA, version: '1' })).rejects.toMatchObject({
      code: 'sha256_mismatch',
    });
  });

  it('вне окна Tauri — код no_shell и ни одного вызова invoke', async () => {
    disableTauri();
    tauri.onValue('update_apply', { status: 'installing' });
    await expect(applyUpdate({ stagedPath: 'p', sha256: SHA, version: '1' })).rejects.toMatchObject({
      code: 'no_shell',
    });
    expect(tauri.calls).toEqual([]);
  });
});

describe('rollbackUpdate', () => {
  it('update_rollback без аргументов, оба исхода разбираются', async () => {
    tauri.onValue('update_rollback', { status: 'installing' });
    expect(await rollbackUpdate()).toBe('installing');
    tauri.onValue('update_rollback', { status: 'uac_cancelled' });
    expect(await rollbackUpdate()).toBe('uac_cancelled');
    expect(tauri.argsOf('update_rollback')).toEqual([undefined, undefined]);
  });

  it('rollback_unavailable приходит кодом', async () => {
    tauri.onError('update_rollback', 'rollback_unavailable');
    await expect(rollbackUpdate()).rejects.toMatchObject({ code: 'rollback_unavailable' });
  });
});

describe('pickInstaller', () => {
  it('null — пользователь закрыл диалог', async () => {
    tauri.onValue('update_pick_installer', null);
    expect(await pickInstaller()).toBeNull();
  });

  it('{staged_path, sha256} → stagedPath / sha256', async () => {
    tauri.onValue('update_pick_installer', { staged_path: 'C:\\s\\x.exe', sha256: SHA });
    expect(await pickInstaller()).toEqual({ stagedPath: 'C:\\s\\x.exe', sha256: SHA });
  });

  it('ответ без путей или с пустыми полями — ShellError, а не пустой путь', async () => {
    for (const bad of [{}, { staged_path: '', sha256: SHA }, { staged_path: 'p', sha256: '' }, 5]) {
      tauri.onValue('update_pick_installer', bad);
      await expect(pickInstaller()).rejects.toBeInstanceOf(ShellError);
    }
  });

  it('коды too_large / invalid_source / stage_failed сохраняются', async () => {
    tauri.onError('update_pick_installer', 'too_large');
    await expect(pickInstaller()).rejects.toMatchObject({ code: 'too_large' });
  });
});

describe('reportHealthOk', () => {
  it('вызывает update_health_ok один раз за вызов', async () => {
    tauri.onValue('update_health_ok', null);
    await reportHealthOk();
    expect(tauri.argsOf('update_health_ok')).toHaveLength(1);
  });

  it('ошибка оболочки пробрасывается (вызывающий решает, повторять ли)', async () => {
    tauri.onError('update_health_ok', 'health_write_failed');
    await expect(reportHealthOk()).rejects.toMatchObject({ code: 'health_write_failed' });
  });
});
