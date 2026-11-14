// SPDX-License-Identifier: GPL-3.0-only

// useConnectFlash.test.tsx — вспышка фона только при переходе в `on`, не при первом показе.
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, useState } from 'react';
import type { BgConn } from '../lib/bgState';
import { mountBare, unmountAll } from '../test-utils/coreStub';
import { useConnectFlash } from './useConnectFlash';

let seen = -1;
let setConn: (c: BgConn) => void = () => undefined;

function Probe({ start }: { start: BgConn }): null {
  const [conn, set] = useState<BgConn>(start);
  setConn = set;
  seen = useConnectFlash(conn);
  return null;
}

const to = (c: BgConn): Promise<void> =>
  act(async () => {
    setConn(c);
    await Promise.resolve();
  });

afterEach(unmountAll);

describe('useConnectFlash: загрузка статуса', () => {
  it('первая смена off → on (окно открыто поверх работающего ядра) не считается; mid → on считается', async () => {
    await mountBare(createElement(Probe, { start: 'off' }));
    await to('on');
    expect(seen).toBe(0);
    await to('off');
    await to('mid');
    await to('on');
    expect(seen).toBe(1);
  });
});

describe('useConnectFlash', () => {
  it('уже подключено при монтировании: 0; mid→on: 1; on→on: 1; err→on: 2', async () => {
    await mountBare(createElement(Probe, { start: 'on' }));
    expect(seen).toBe(0);
    await to('off');
    await to('mid');
    expect(seen).toBe(0);
    await to('on');
    expect(seen).toBe(1);
    await to('on');
    expect(seen).toBe(1);
    await to('err');
    await to('on');
    expect(seen).toBe(2);
  });
});
