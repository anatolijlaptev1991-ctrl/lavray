// SPDX-License-Identifier: GPL-3.0-only

// networks.test.ts — транспорты редактора: XHTTP не предлагается новому профилю, но
// остаётся у существующего XHTTP-профиля.
import { describe, expect, it } from 'vitest';
import { StreamSettings_Network } from '../../gen/lavray_pb';
import { networkHasPath, networkOptions } from './networks';

const values = (current: StreamSettings_Network): StreamSettings_Network[] =>
  networkOptions(current).map((o) => o.value);

describe('networkOptions', () => {
  it('новому профилю (TCP по умолчанию) XHTTP не предлагается', () => {
    expect(values(StreamSettings_Network.TCP)).not.toContain(StreamSettings_Network.XHTTP);
    expect(values(StreamSettings_Network.TCP)).toContain(StreamSettings_Network.WS);
  });

  it('профиль с другим транспортом тоже не получает XHTTP', () => {
    for (const n of [StreamSettings_Network.WS, StreamSettings_Network.GRPC, StreamSettings_Network.HTTP_UPGRADE]) {
      expect(values(n), String(n)).not.toContain(StreamSettings_Network.XHTTP);
    }
  });

  it('существующий XHTTP-профиль видит XHTTP в списке: правка не превращает его в TCP', () => {
    expect(values(StreamSettings_Network.XHTTP)).toContain(StreamSettings_Network.XHTTP);
    expect(values(StreamSettings_Network.XHTTP)).toHaveLength(values(StreamSettings_Network.TCP).length + 1);
  });

  it('у XHTTP есть поля пути и хоста', () => {
    expect(networkHasPath(StreamSettings_Network.XHTTP)).toBe(true);
    expect(networkHasPath(StreamSettings_Network.TCP)).toBe(false);
  });
});
