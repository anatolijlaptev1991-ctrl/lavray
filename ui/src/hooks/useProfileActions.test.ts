// SPDX-License-Identifier: GPL-3.0-only

// useProfileActions.test.ts — имя файла экспорта конфига: из имени сервера без
// символов, недопустимых в Windows, и без управляющих.
import { describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { ProfileSchema } from '../gen/lavray_pb';
import { exportFileName } from './useProfileActions';

const named = (name: string): ReturnType<typeof create<typeof ProfileSchema>> =>
  create(ProfileSchema, { id: 7n, name });

describe('exportFileName', () => {
  it('обычное имя остаётся как есть', () => {
    expect(exportFileName(named('NL-1 fast'))).toBe('NL-1 fast');
  });

  it('символы <>:"/\\|?* и управляющие заменяются пробелами (S)', () => {
    expect(exportFileName(named('a<b>c:d"e/f\\g|h?i*j\u0001k'))).toBe('a b c d e f g h i j k');
  });

  it('пустое или состоящее из недопустимых символов имя — по id (E)', () => {
    expect(exportFileName(named(''))).toBe('profile-7');
    expect(exportFileName(named('???'))).toBe('profile-7');
  });

  it('длинное имя обрезается до 60 символов (B)', () => {
    expect(exportFileName(named('x'.repeat(200)))).toHaveLength(60);
  });

  it('имя с эмодзи не ломается', () => {
    expect(exportFileName(named('🇳🇱 Amsterdam'))).toBe('🇳🇱 Amsterdam');
  });
});
