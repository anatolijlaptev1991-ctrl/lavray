// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from 'vitest';
import { CoreState } from '../gen/lavray_pb';
import { bgConnOf } from './bgState';

describe('bgConnOf', () => {
  it.each([
    [CoreState.IDLE, 'off'],
    [CoreState.DISCONNECTING, 'off'],
    [CoreState.CONNECTING, 'mid'],
    [CoreState.RECONNECTING, 'mid'],
    [CoreState.CONNECTED, 'on'],
    [CoreState.ERROR, 'err'],
  ] as const)('состояние %s даёт %s', (state, want) => {
    expect(bgConnOf(state)).toBe(want);
  });
});
