// SPDX-License-Identifier: GPL-3.0-only

// secretWarning.test.ts — какие ссылки считаются несущими секрет.
import { describe, expect, it } from 'vitest';
import { linkHasSecret } from './secretWarning';

const UUID = 'b831381d-6324-4d53-ad4f-8cda48b30811';
const b64 = (s: string): string => btoa(s);

describe('linkHasSecret', () => {
  it('link_secret_detection: vless с uuid', () => {
    expect(linkHasSecret(`vless://${UUID}@example.org:443?security=tls#n`)).toBe(true);
  });

  it('link_secret_detection: ss с userinfo (SIP002 и открытый «метод:пароль»)', () => {
    expect(linkHasSecret(`ss://${b64('aes-256-gcm:pass')}@1.2.3.4:8388#n`)).toBe(true);
    expect(linkHasSecret('ss://aes-256-gcm:pass@1.2.3.4:8388')).toBe(true);
  });

  it('link_secret_detection: ss старой формы — секрет внутри base64 без «@»', () => {
    expect(linkHasSecret(`ss://${b64('aes-256-gcm:pass@1.2.3.4:8388')}#n`)).toBe(true);
  });

  it('link_secret_detection: trojan с паролем', () => {
    expect(linkHasSecret('trojan://s3cret@example.org:443?sni=example.org#n')).toBe(true);
  });

  it('link_secret_detection: vmess base64 с id (и без id)', () => {
    const withId = b64(JSON.stringify({ v: '2', ps: 'n', add: 'example.org', port: '443', id: UUID }));
    const noId = b64(JSON.stringify({ v: '2', ps: 'n', add: 'example.org', port: '443' }));
    expect(linkHasSecret(`vmess://${withId}`)).toBe(true);
    expect(linkHasSecret(`vmess://${noId}`)).toBe(false);
  });

  it('link_secret_detection: ключи в параметрах (pbk, psk, password, auth)', () => {
    expect(linkHasSecret('hysteria2://example.org:443?auth=abc#n')).toBe(true);
    expect(linkHasSecret('vless://example.org:443?security=reality&pbk=AbCd#n')).toBe(true);
    expect(linkHasSecret('tuic://example.org:443?psk=zzz#n')).toBe(true);
    expect(linkHasSecret('socks5://example.org:1080?Password=p#n')).toBe(true);
  });

  it('link_secret_detection: ссылка без секретов — false', () => {
    expect(linkHasSecret('socks5://127.0.0.1:1080#local')).toBe(false);
    expect(linkHasSecret('https://example.org/sub?name=x')).toBe(false);
    expect(linkHasSecret('vless://example.org:443?security=tls&pbk=#empty')).toBe(false);
    expect(linkHasSecret('просто текст')).toBe(false);
    expect(linkHasSecret('')).toBe(false);
  });

  it('https-подписка с логином или токеном — секрет', () => {
    expect(linkHasSecret('https://user:pw@example.org/sub')).toBe(true);
    expect(linkHasSecret('https://example.org/sub?token=abc')).toBe(true);
  });
});
