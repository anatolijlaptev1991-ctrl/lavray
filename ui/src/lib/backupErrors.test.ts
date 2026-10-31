// SPDX-License-Identifier: GPL-3.0-only

import { Code, ConnectError } from '@connectrpc/connect';
import { describe, expect, it } from 'vitest';
import { backupErrorKey, backupErrorText, decodeErrorInfo, errorReason } from './backupErrors';
import { setLanguage, t } from './i18n';
import { coreError, errorInfoBytes } from '../test-utils/coreError';

describe('ошибки копии (T-83)', () => {
  it('разбирает reason и domain, пропуская остальные поля', () => {
    expect(decodeErrorInfo(errorInfoBytes('backup_busy'))).toEqual({ reason: 'backup_busy', domain: 'lavray.core' });
    expect(decodeErrorInfo(new Uint8Array())).toEqual({ reason: '', domain: '' });
    // обрезанные и мусорные байты не бросают исключений
    expect(() => decodeErrorInfo(Uint8Array.from([0x0a, 50, 1, 2]))).not.toThrow();
    expect(() => decodeErrorInfo(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))).not.toThrow();
  });

  it('каждая причина ядра имеет свой ключ словаря', () => {
    const cases: readonly (readonly [Code, string, string])[] = [
      [Code.InvalidArgument, 'password_too_short', 'bk.err.pwShort'],
      [Code.InvalidArgument, 'password_too_long', 'bk.err.pwLong'],
      [Code.InvalidArgument, 'backup_not_recognized', 'bk.err.notRecognized'],
      [Code.PermissionDenied, 'backup_wrong_password', 'bk.err.wrongPassword'],
      [Code.DataLoss, 'backup_tampered', 'bk.err.tampered'],
      [Code.FailedPrecondition, 'backup_from_newer_version', 'bk.err.newer'],
      [Code.FailedPrecondition, 'confirm_replace_required', 'bk.err.confirm'],
      [Code.FailedPrecondition, 'connection_active', 'bk.err.connected'],
      [Code.ResourceExhausted, 'backup_too_large', 'bk.err.tooLarge'],
      [Code.Aborted, 'backup_busy', 'bk.err.busy'],
    ];
    for (const [code, reason, key] of cases) {
      expect(backupErrorKey(coreError(code, reason)), reason).toBe(key);
    }
  });

  it('без причины ключ выбирается по коду; чужой домен и не-ошибки Connect игнорируются', () => {
    expect(backupErrorKey(coreError(Code.PermissionDenied, null))).toBe('bk.err.wrongPassword');
    expect(backupErrorKey(coreError(Code.ResourceExhausted, null))).toBe('bk.err.tooLarge');
    expect(backupErrorKey(coreError(Code.DataLoss, null))).toBe('bk.err.tampered');
    expect(backupErrorKey(coreError(Code.Internal, null))).toBeNull();
    expect(backupErrorKey(coreError(Code.Internal, 'backup_busy', 'other.domain'))).toBeNull();
    expect(errorReason(coreError(Code.Aborted, 'x', 'other.domain'))).toBeNull();
    expect(backupErrorKey(new Error('boom'))).toBeNull();
    expect(backupErrorKey('строка')).toBeNull();
  });

  it('текст берётся из словаря на языке интерфейса, остальное — общий разбор', () => {
    setLanguage('de');
    expect(backupErrorText(coreError(Code.PermissionDenied, 'backup_wrong_password'), t)).toBe('Falsches Passwort');
    setLanguage('en');
    expect(backupErrorText(coreError(Code.PermissionDenied, 'backup_wrong_password'), t)).toBe('Wrong password');
    expect(backupErrorText(new ConnectError('unimplemented', Code.Unimplemented), t)).toBe(t('err.unimplemented'));
  });
});
