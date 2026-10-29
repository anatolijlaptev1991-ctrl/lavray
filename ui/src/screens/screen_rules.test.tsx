// screen_rules.test.tsx — регрессия T-69: повторный ввод существующей записи не
// удаляет её, ✕ на чипе удаляет, пустой набор показывает «Правил нет».
// @testing-library в проекте не установлен — react-dom/client + act и обычный DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { RoutingPresetSchema } from '../gen/lavray_pb';
import type { RoutingPreset } from '../gen/lavray_pb';
import { CoreContext } from '../hooks/useCore';
import type { CoreClients } from '../lib/core';
import { setLanguage, t } from '../lib/i18n';
import { RulesScreen } from './screen_rules';

interface UpdateReq {
  readonly preset: RoutingPreset;
  readonly expectedRevision: number;
}

interface Fake {
  readonly clients: CoreClients;
  readonly updatePreset: Mock<(req: UpdateReq) => Promise<{ preset: RoutingPreset }>>;
}

function fakeClients(preset: RoutingPreset): Fake {
  const updatePreset = vi.fn((req: UpdateReq) =>
    Promise.resolve({ preset: create(RoutingPresetSchema, { ...req.preset, revision: req.expectedRevision + 1 }) }),
  );
  const clients = {
    routing: {
      listPresets: () => Promise.resolve({ presets: [preset], activePresetId: preset.id }),
      updatePreset,
    },
  } as unknown as CoreClients;
  return { clients, updatePreset };
}

const mine = (init: MessageInitShape<typeof RoutingPresetSchema> = {}): RoutingPreset =>
  create(RoutingPresetSchema, { id: 'custom:mine', displayName: 'Mine', builtin: false, revision: 3, ...init });

describe('RulesScreen (T-69)', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setLanguage('ru');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function open(fake: Fake): Promise<void> {
    act(() => {
      root?.render(createElement(CoreContext.Provider, { value: fake.clients }, createElement(RulesScreen)));
    });
    await flush();
  }

  const text = (el: Element | null | undefined): string => (el?.textContent ?? '').trim();
  const chips = (kind: string): string[] =>
    Array.from(document.querySelectorAll('details')).flatMap((d) =>
      d.querySelector(`[data-rule-add="${kind}"]`) === null
        ? []
        : Array.from(d.querySelectorAll('.rule-chip')).map((c) => text(c)),
    );

  /** Ввод записи в инлайн-поле списка `kind` и Enter. */
  async function enter(kind: string, value: string): Promise<void> {
    const input = document.querySelector<HTMLInputElement>(`[data-rule-add="${kind}"] input`);
    if (input === null) throw new Error(`нет поля ввода для ${kind}`);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });
    await flush();
  }

  it('повторный ввод существующей записи не удаляет её и не шлёт UpdatePreset', async () => {
    const fake = fakeClients(mine({ proxyDomain: ['ads.example', 'other.example'] }));
    await open(fake);
    expect(chips('proxyDomain')).toEqual(['ads.example', 'other.example']);
    await enter('proxyDomain', 'ads.example');
    expect(fake.updatePreset).not.toHaveBeenCalled();
    expect(chips('proxyDomain')).toEqual(['ads.example', 'other.example']);
    expect(text(document.querySelector('.toast-ok'))).toBe(t('rt.ruleExists'));
  });

  it('регистр при проверке повтора не важен', async () => {
    const fake = fakeClients(mine({ proxyDomain: ['ads.example'] }));
    await open(fake);
    await enter('proxyDomain', '  ADS.Example ');
    expect(fake.updatePreset).not.toHaveBeenCalled();
    expect(chips('proxyDomain')).toEqual(['ads.example']);
  });

  it('новая запись добавляется в конец списка с проверкой ревизии', async () => {
    const fake = fakeClients(mine({ proxyDomain: ['ads.example'] }));
    await open(fake);
    await enter('proxyDomain', 'new.example');
    expect(fake.updatePreset).toHaveBeenCalledTimes(1);
    const req = fake.updatePreset.mock.calls[0]?.[0];
    expect(req?.preset.proxyDomain).toEqual(['ads.example', 'new.example']);
    expect(req?.expectedRevision).toBe(3);
    expect(chips('proxyDomain')).toEqual(['ads.example', 'new.example']);
  });

  it('✕ на чипе удаляет только эту запись', async () => {
    const fake = fakeClients(mine({ directDomain: ['a.example', 'b.example'] }));
    await open(fake);
    const remove = document.querySelector<HTMLButtonElement>(`button[aria-label="${t('common.delete')} a.example"]`);
    expect(remove).not.toBeNull();
    await act(async () => {
      remove?.click();
      await Promise.resolve();
    });
    await flush();
    expect(fake.updatePreset.mock.calls[0]?.[0].preset.directDomain).toEqual(['b.example']);
    expect(chips('directDomain')).toEqual(['b.example']);
  });

  it('пустой набор показывает «Правил нет», после первого правила — исчезает', async () => {
    const fake = fakeClients(mine());
    await open(fake);
    const empty = document.querySelector('.rules .empty');
    expect(text(empty?.querySelector('.empty-t'))).toBe(t('rt.rulesEmpty'));
    await enter('blockDomain', 'ads.example');
    expect(document.querySelector('.rules .empty')).toBeNull();
  });

  it('набор с правилами пустого состояния не показывает', async () => {
    await open(fakeClients(mine({ blockIp: ['10.0.0.0/8'] })));
    expect(document.querySelector('.rules .empty')).toBeNull();
  });
});
