// SPDX-License-Identifier: GPL-3.0-only

// ruleFromConnection.test.ts — правило из соединения (T-80, VU): домен → full:,
// IPv4 → /32, IPv6 → /128, порт и скобки отбрасываются.
import { describe, expect, it } from 'vitest';
import { conn } from '../test-utils/connsKit';
import { hostOf, ruleFromConnection } from './ruleFromConnection';
import type { ConnRule } from './ruleFromConnection';

describe('hostOf', () => {
  it('убирает порт и скобки IPv6', () => {
    expect(hostOf('example.org:443')).toBe('example.org');
    expect(hostOf('example.org')).toBe('example.org');
    expect(hostOf('1.2.3.4:80')).toBe('1.2.3.4');
    expect(hostOf('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(hostOf('2001:db8::1')).toBe('2001:db8::1');
    expect(hostOf('[broken')).toBe('');
  });
});

describe('ruleFromConnection', () => {
  const rule = (destination: string, resolved?: string, out: 'direct' | 'proxy' = 'direct'): ConnRule | null =>
    ruleFromConnection(conn('x', { destination, ...(resolved === undefined ? {} : { resolvedDestination: resolved }) }), out);

  it('домен → full:<домен> в списке доменов нужного выхода', () => {
    expect(rule('Video.Example.com:443')).toEqual({ kind: 'directDomain', entry: 'full:video.example.com' });
    expect(rule('video.example.com:443', undefined, 'proxy')).toEqual({ kind: 'proxyDomain', entry: 'full:video.example.com' });
  });

  it('IPv4 → /32, IPv6 → /128 в ip-списках', () => {
    expect(rule('93.184.216.34:443')).toEqual({ kind: 'directIp', entry: '93.184.216.34/32' });
    expect(rule('[2001:db8::1]:443', undefined, 'proxy')).toEqual({ kind: 'proxyIp', entry: '2001:db8::1/128' });
  });

  it('запрошен IP, а сниффинг нашёл домен — правило по домену', () => {
    expect(rule('93.184.216.34:443', 'example.org:443')).toEqual({ kind: 'directDomain', entry: 'full:example.org' });
    expect(rule('93.184.216.34:443', '93.184.216.34:443')).toEqual({ kind: 'directIp', entry: '93.184.216.34/32' });
    expect(rule('example.org:443', '93.184.216.34:443')).toEqual({ kind: 'directDomain', entry: 'full:example.org' });
  });

  it('(I) негодный адрес — null', () => {
    expect(rule('')).toBeNull();
    expect(rule(':443')).toBeNull();
    expect(rule('[broken')).toBeNull();
    expect(rule('bad host:80')).toBeNull();
    expect(rule('300.1.1.1:80')?.kind).toBe('directDomain'); // не IPv4 — трактуется как имя
  });
});
