// SPDX-License-Identifier: GPL-3.0-only

// usePresets.test.tsx — порядок операций над наборами (T-80, C): две правки
// подряд не уходят в ядро одновременно, вторая берёт ревизию из ответа первой,
// поэтому «конфликта с самим собой» не бывает. Ядро подставное (vi.fn).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import { RoutingPresetSchema } from '../gen/lavray_pb';
import type { RoutingPreset } from '../gen/lavray_pb';
import { setLanguage } from '../lib/i18n';
import { CoreContext } from './useCore';
import type { CoreClients } from '../lib/core';
import { usePresets } from './usePresets';
import type { PresetsApi } from './usePresets';

const MINE = create(RoutingPresetSchema, { id: 'custom:mine', displayName: 'Mine', revision: 3 });

interface Deferred {
  readonly promise: Promise<{ preset: RoutingPreset; needsProfileRestart: boolean }>;
  readonly resolve: (preset: RoutingPreset) => void;
}

function deferred(): Deferred {
  let resolve: Deferred['resolve'] = () => undefined;
  const promise = new Promise<{ preset: RoutingPreset; needsProfileRestart: boolean }>((res) => {
    resolve = (preset): void => { res({ preset, needsProfileRestart: false }); };
  });
  return { promise, resolve };
}

let root: Root | undefined;
let api: PresetsApi | undefined;

function Probe(): ReactElement | null {
  api = usePresets();
  return null;
}

async function mountProbe(routing: object): Promise<void> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(CoreContext.Provider, { value: { routing } as unknown as CoreClients }, createElement(Probe)));
    await Promise.resolve();
  });
}

afterEach(() => {
  act(() => { root?.unmount(); });
  api = undefined;
});

describe('usePresets', () => {
  it('две правки подряд: вторая ждёт первую и идёт со свежей ревизией', async () => {
    setLanguage('en');
    const first = deferred();
    const updatePreset = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockImplementation(({ preset }: { preset: RoutingPreset }) => Promise.resolve({ preset, needsProfileRestart: false }));
    await mountProbe({
      listPresets: () => Promise.resolve({ presets: [MINE], activePresetId: 'custom:mine' }),
      updatePreset,
    });
    await act(async () => {
      void api?.update('custom:mine', { lists: { blockDomain: ['one.example'] } });
      void api?.update('custom:mine', { lists: { blockDomain: ['one.example', 'two.example'] } });
      await Promise.resolve();
    });
    expect(updatePreset).toHaveBeenCalledTimes(1); // вторая ещё не стартовала
    await act(async () => {
      first.resolve(create(RoutingPresetSchema, { ...MINE, revision: 4, blockDomain: ['one.example'] }));
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(updatePreset).toHaveBeenCalledTimes(2);
    const revisions = (updatePreset.mock.calls as [{ expectedRevision: number }][]).map((c) => c[0].expectedRevision);
    expect(revisions).toEqual([3, 4]);
    expect(api?.note?.kind).toBe('ok');
  });

  it('пустая правка (то же значение) в ядро не уходит', async () => {
    setLanguage('en');
    const updatePreset = vi.fn();
    await mountProbe({
      listPresets: () => Promise.resolve({ presets: [MINE], activePresetId: 'custom:mine' }),
      updatePreset,
    });
    await act(async () => {
      await api?.update('custom:mine', { displayName: 'Mine', lists: { blockDomain: [] } });
    });
    expect(updatePreset).not.toHaveBeenCalled();
    expect(api?.note).toBeNull();
  });
});
