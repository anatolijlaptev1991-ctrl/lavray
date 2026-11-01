// SPDX-License-Identifier: GPL-3.0-only

// dnsLabel.ts — короткая подпись удалённого DNS активного набора правил для
// правой панели «Подключение»: карточка из экрана DNS («Авто», «Через туннель»,
// «DoH», …) либо адрес из своих серверов. Тексты берутся из тех же ключей,
// что и карточки экрана DNS.
import { DnsSettings_Mode } from '../gen/lavray_pb';
import type { DnsSettings } from '../gen/lavray_pb';
import type { MessageKey } from './i18n';

const CHOICE_KEYS: Readonly<Record<string, MessageKey>> = {
  auto: 'dns.auto',
  tunnel: 'dns.tunnel',
  doh: 'dns.doh',
  dot: 'dns.dot',
  local: 'dns.local',
};

/** Хост из адреса DNS (`https://dns.google/dns-query` → `dns.google`); не адрес — как есть. */
export function dnsHost(address: string): string {
  const text = address.trim();
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:\[([^\]]+)\]|([^/:?#]+))/i.exec(text);
  return match?.[1] ?? match?.[2] ?? text;
}

/** Подпись DNS набора; null — настройки ещё не прочитаны. */
export function dnsLabel(dns: DnsSettings | null, t: (key: MessageKey) => string): string | null {
  if (dns === null) return null;
  if (dns.mode === DnsSettings_Mode.ADVANCED) return t('dns.adv');
  const choice = dns.choice ?? '';
  const key = CHOICE_KEYS[choice];
  if (key !== undefined) return t(key);
  const host = dnsHost(dns.remoteDns ?? '');
  return host === '' ? t('dns.auto') : host;
}
