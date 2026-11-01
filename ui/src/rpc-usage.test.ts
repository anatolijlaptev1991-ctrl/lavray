// SPDX-License-Identifier: GPL-3.0-only

// rpc-usage.test.ts — хвосты B, 7.1: каждый RPC из proto либо вызывается в ui/src,
// либо внесён в rpc-unused.allow.ts с причиной. То же проверяет scripts/rpc_usage.py
// (его гоняет CI); здесь правило видно в обычном прогоне vitest. Раньше в ядре копились
// RPC без интерфейса (Clone, ResetTraffic, ResolveDomains, ExportConfig…), и никто
// не замечал, что кнопки для них нет.
import { describe, expect, it } from 'vitest';
import protoText from '../proto/lavray.proto?raw';
import { RPC_UNUSED_ALLOWED } from './rpc-unused.allow';

/** Исходники интерфейса, в которых вызов считается: без тестов, gen и тестовых помощников. */
const sources = import.meta.glob<string>(
  [
    './**/*.{ts,tsx}',
    '!./**/*.test.{ts,tsx}',
    '!./**/*.d.ts',
    '!./gen/**',
    '!./test-utils/**',
    '!./test-harness.ts',
    '!./test-setup.ts',
    '!./rpc-unused.allow.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
);
const code = Object.values(sources).join('\n');

/** Сервис → поле клиента в CoreClients (lib/core.ts). */
const CLIENT_BY_SERVICE: Readonly<Record<string, string>> = {
  CoreService: 'core',
  ProfileService: 'profiles',
  SubscriptionService: 'subscriptions',
  RoutingService: 'routing',
  DnsService: 'dns',
  SettingsService: 'settings',
  LogService: 'logs',
  StatsService: 'stats',
  ConnectionService: 'connections',
  DiagnosticsService: 'diagnostics',
  UpdateService: 'updates',
  BackupService: 'backup',
};

/** Все RPC proto в виде «Сервис/Метод». */
function protoRpcs(): string[] {
  const out: string[] = [];
  const services = [...protoText.matchAll(/^service\s+(\w+)\s*\{/gm)];
  services.forEach((svc, i) => {
    const end = services[i + 1]?.index ?? protoText.length;
    const body = protoText.slice(svc.index + svc[0].length, end);
    for (const m of body.matchAll(/^\s*rpc\s+(\w+)\s*\(/gm)) out.push(`${svc[1] ?? ''}/${m[1] ?? ''}`);
  });
  return out;
}

function isCalled(rpc: string): boolean {
  const [service = '', method = ''] = rpc.split('/');
  const client = CLIENT_BY_SERVICE[service];
  if (client === undefined) return false;
  const name = method.charAt(0).toLowerCase() + method.slice(1);
  return new RegExp(`(?<![\\w.])${client}\\s*\\.\\s*${name}\\s*\\(|\\.${client}\\s*\\.\\s*${name}\\s*\\(`).test(code);
}

const RPCS = protoRpcs();

describe('rpc-usage: у каждого RPC есть интерфейс или причина', () => {
  it('разбор proto и исходников что-то находит (проверка самого теста)', () => {
    expect(RPCS.length).toBeGreaterThan(80);
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    expect(isCalled('ProfileService/ListProfiles')).toBe(true);
    expect(isCalled('ProfileService/NoSuchMethod')).toBe(false);
  });

  it('каждый RPC вызывается в ui/src либо внесён в rpc-unused.allow.ts', () => {
    const missing = RPCS.filter((rpc) => !isCalled(rpc) && !(rpc in RPC_UNUSED_ALLOWED));
    expect(missing).toEqual([]);
  });

  it('в списке разрешённых нет устаревших записей: вызывается — запись удалить', () => {
    const stale = Object.keys(RPC_UNUSED_ALLOWED).filter((rpc) => isCalled(rpc));
    expect(stale).toEqual([]);
  });

  it('в списке разрешённых нет RPC, которых нет в proto', () => {
    const unknown = Object.keys(RPC_UNUSED_ALLOWED).filter((rpc) => !RPCS.includes(rpc));
    expect(unknown).toEqual([]);
  });

  it('у каждой записи есть причина', () => {
    const empty = Object.entries(RPC_UNUSED_ALLOWED)
      .filter(([, reason]) => reason.trim().length < 10)
      .map(([rpc]) => rpc);
    expect(empty).toEqual([]);
  });

  it('RPC, для которых хвосты B построили интерфейс, вызываются и не прячутся в списке разрешённых', () => {
    const built = [
      'ProfileService/MoveProfiles',
      'ProfileService/CloneProfiles',
      'ProfileService/ResetTraffic',
      'ProfileService/ResolveDomains',
      'ProfileService/ExportConfig',
      'ProfileService/RemoveUnavailableProfiles',
      'ProfileService/DeduplicateProfiles',
      'CoreService/RestartProfile',
      'CoreService/GetRuntimeConfig',
      'SubscriptionService/UpdateAllSubscriptions',
      'SubscriptionService/RollbackSubscription',
      'StatsService/GetTrafficSummary',
      'SettingsService/SubscribeSettings',
      'DiagnosticsService/GetPublicIp',
    ];
    for (const rpc of built) {
      expect(RPCS, rpc).toContain(rpc);
      expect(isCalled(rpc), `${rpc} не вызывается`).toBe(true);
      expect(rpc in RPC_UNUSED_ALLOWED, `${rpc} стоит в списке разрешённых`).toBe(false);
    }
  });
});
