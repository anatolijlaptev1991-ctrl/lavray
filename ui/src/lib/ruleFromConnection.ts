// SPDX-License-Identifier: GPL-3.0-only

// ruleFromConnection.ts — правило набора из строки экрана «Соединения» (T-80):
// домен → `full:<домен>`, IP → `<ip>/32` (IPv4) или `<ip>/128` (IPv6). Адрес
// берётся из resolved_destination, если запрошен был IP, а определился домен
// (так правило ловит сайт, а не один из его адресов).
import type { Connection } from '../gen/lavray_pb';
import type { ListKind } from './presetDraft';

export type RuleOutbound = 'direct' | 'proxy';

export interface ConnRule {
  readonly kind: ListKind;
  readonly entry: string;
}

/** Адрес без порта: `host:443`, `[::1]:443`, `::1`, `1.2.3.4`. */
export function hostOf(address: string): string {
  const a = address.trim();
  if (a.startsWith('[')) {
    const end = a.indexOf(']');
    return end > 0 ? a.slice(1, end) : '';
  }
  const colons = a.split(':').length - 1;
  return colons === 1 ? a.slice(0, a.indexOf(':')) : a;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const isIPv4 = (h: string): boolean => {
  const m = IPV4.exec(h);
  return m?.slice(1).every((o) => Number(o) <= 255) === true;
};

const isIPv6 = (h: string): boolean => h.includes(':') && /^[0-9a-f:.]+$/i.test(h) && h.split(':').length >= 3;

/** Пригодное для правила имя домена: без пробелов, разделителей пути и служебных знаков. */
const isDomain = (h: string): boolean => h !== '' && !/[\s/\\#:@?%*]/.test(h);

/** Правило «напрямую» / «через прокси» для соединения; null — адрес для правила не годится. */
export function ruleFromConnection(c: Connection, out: RuleOutbound): ConnRule | null {
  let host = hostOf(c.destination).toLowerCase();
  const resolved = hostOf(c.resolvedDestination ?? '').toLowerCase();
  if ((isIPv4(host) || isIPv6(host)) && resolved !== '' && isDomain(resolved) && !isIPv4(resolved) && !isIPv6(resolved)) {
    host = resolved;
  }
  if (isIPv4(host)) return { kind: out === 'direct' ? 'directIp' : 'proxyIp', entry: `${host}/32` };
  if (isIPv6(host)) return { kind: out === 'direct' ? 'directIp' : 'proxyIp', entry: `${host}/128` };
  if (!isDomain(host)) return null;
  return { kind: out === 'direct' ? 'directDomain' : 'proxyDomain', entry: `full:${host}` };
}
