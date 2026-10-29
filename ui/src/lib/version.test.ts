// T-71: версия приложения в «Настройках» — из ui/package.json, а не литерал.
import { describe, expect, it } from 'vitest';
import { version } from '../../package.json';
import { APP_VERSION } from './version';

describe('APP_VERSION', () => {
  it('совпадает с версией из package.json и похожа на semver', () => {
    expect(APP_VERSION).toBe(version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
