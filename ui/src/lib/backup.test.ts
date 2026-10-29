// SPDX-License-Identifier: GPL-3.0-only

// T-13: экспорт настроек не должен уносить секреты.
import { describe, expect, it } from 'vitest';
import { isSecretSettingKey, withoutSecrets } from './backup';

describe('isSecretSettingKey', () => {
  it.each(['inbound.auth.pass', 'core.clash_api.secret', 'web.token', 'x.password', 'PASS'])(
    'считает секретом %s',
    (key) => {
      expect(isSecretSettingKey(key)).toBe(true);
    },
  );

  it.each([
    'inbound.auth.user',
    'inbound.port',
    'tun.bypass_process',
    'sub.user_agent',
    'security.allow_insecure_default',
    'passthrough',
  ])('не считает секретом %s', (key) => {
    expect(isSecretSettingKey(key)).toBe(false);
  });
});

describe('withoutSecrets', () => {
  it('возвращает копию без секретных ключей и не меняет исходный объект', () => {
    const src = { 'inbound.port': 2080, 'inbound.auth.user': 'neko', 'inbound.auth.pass': 'p@ss' } as const;
    const out = withoutSecrets(src);
    expect(out).toEqual({ 'inbound.port': 2080, 'inbound.auth.user': 'neko' });
    expect(src['inbound.auth.pass']).toBe('p@ss');
    expect(out).not.toBe(src);
  });
});
