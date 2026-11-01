// SPDX-License-Identifier: GPL-3.0-only

// networks.ts — транспорты потока в редакторе профиля. XHTTP в списке есть,
// хотя ядро его не собирает (Profile.unsupported_reason): без него правка
// импортированного профиля показывала бы TCP и сохраняла его вместо XHTTP.
import { StreamSettings_Network } from '../../gen/lavray_pb';
import type { Option } from './fields';

const NETWORKS: readonly Option<StreamSettings_Network>[] = [
  { value: StreamSettings_Network.TCP, label: 'TCP' },
  { value: StreamSettings_Network.WS, label: 'WebSocket' },
  { value: StreamSettings_Network.GRPC, label: 'gRPC' },
  { value: StreamSettings_Network.HTTP, label: 'HTTP/2' },
  { value: StreamSettings_Network.HTTP_UPGRADE, label: 'HTTPUpgrade' },
  { value: StreamSettings_Network.XHTTP, label: 'XHTTP' },
];

/**
 * Транспорты, которые можно выбрать. XHTTP ядро не собирает, поэтому новому профилю
 * его не предлагаем; у профиля, который уже XHTTP, он остаётся в списке — иначе
 * правка показала бы другой транспорт и сохранила его вместо XHTTP.
 */
export function networkOptions(current: StreamSettings_Network): readonly Option<StreamSettings_Network>[] {
  return current === StreamSettings_Network.XHTTP
    ? NETWORKS
    : NETWORKS.filter((o) => o.value !== StreamSettings_Network.XHTTP);
}

const WITH_PATH: readonly StreamSettings_Network[] = [
  StreamSettings_Network.WS,
  StreamSettings_Network.HTTP,
  StreamSettings_Network.HTTP_UPGRADE,
  StreamSettings_Network.XHTTP,
];

/** У транспорта есть поля «путь» и «хост». */
export function networkHasPath(network: StreamSettings_Network): boolean {
  return WITH_PATH.includes(network);
}
