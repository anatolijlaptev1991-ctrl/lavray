// SPDX-License-Identifier: GPL-3.0-only

// networks.ts — транспорты потока в редакторе профиля. XHTTP в списке есть,
// хотя ядро его не собирает (Profile.unsupported_reason): без него правка
// импортированного профиля показывала бы TCP и сохраняла его вместо XHTTP.
import { StreamSettings_Network } from '../../gen/lavray_pb';
import type { Option } from './fields';

export const NETWORKS: readonly Option<StreamSettings_Network>[] = [
  { value: StreamSettings_Network.TCP, label: 'TCP' },
  { value: StreamSettings_Network.WS, label: 'WebSocket' },
  { value: StreamSettings_Network.GRPC, label: 'gRPC' },
  { value: StreamSettings_Network.HTTP, label: 'HTTP/2' },
  { value: StreamSettings_Network.HTTP_UPGRADE, label: 'HTTPUpgrade' },
  { value: StreamSettings_Network.XHTTP, label: 'XHTTP' },
];

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
