// SPDX-License-Identifier: GPL-3.0-only

// D-3: ленивые экраны и диалоги. Пока чанк грузится — статус для скринридера;
// не загрузился — сообщение и «Повторить» (а не пустой экран); после «Повторить»
// чанк запрашивается заново. Ошибка рендера идёт выше, как до разделения.
import { Component, act } from 'react';
import type { JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DICTIONARIES } from '../lib/i18n';
import { lazyView } from '../lib/lazyView';
import { LazyBoundary } from './LazyBoundary';

const en = DICTIONARIES.en;
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  // React пишет в console.error каждую пойманную границей ошибку — это ожидаемо.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => {
    root.unmount();
  });
  host.remove();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  });
}

function Hello(): JSX.Element {
  return <p id="hello">hello</p>;
}

describe('LazyBoundary', () => {
  it('пока чанк грузится — role=status/aria-busy с текстом для скринридера, затем экран', async () => {
    let release: (() => void) | undefined;
    const Lazy = lazyView(
      () =>
        new Promise<typeof Hello>((resolve) => {
          release = (): void => {
            resolve(Hello);
          };
        }),
    );
    act(() => {
      root.render(
        <LazyBoundary>
          <Lazy />
        </LazyBoundary>,
      );
    });
    const status = host.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(status?.textContent).toBe(en['lazy.loading']);
    expect(host.querySelector('#hello')).toBeNull();

    release?.();
    await settle();
    expect(host.querySelector('#hello')).not.toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it('чанк не загрузился — сообщение и «Повторить», по кнопке окно перезагружается', async () => {
    const Lazy = lazyView(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ reload } as unknown as Location);
    act(() => {
      root.render(
        <LazyBoundary>
          <Lazy />
        </LazyBoundary>,
      );
    });
    await settle();
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(en['lazy.failed']);
    expect(host.querySelector('#hello')).toBeNull();
    const retry = host.querySelector('button');
    expect(retry?.textContent).toBe(en['err.retry']);

    act(() => {
      retry?.click();
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('диалог: окно ошибки закрывается через onDismiss', async () => {
    const Lazy = lazyView(() => Promise.reject(new Error('offline')));
    const onDismiss = vi.fn();
    act(() => {
      root.render(
        <LazyBoundary onDismiss={onDismiss}>
          <Lazy />
        </LazyBoundary>,
      );
    });
    await settle();
    const close = document.querySelector<HTMLButtonElement>('.dlg-h button');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => {
      close?.click();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ошибка рендера (не загрузки) не перехватывается границей', async () => {
    function Broken(): JSX.Element {
      throw new Error('render failed');
    }
    const Lazy = lazyView(() => Promise.resolve(Broken));
    const seen: unknown[] = [];
    class Outer extends Component<{ children: JSX.Element }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
      }
      componentDidCatch(error: unknown): void {
        seen.push(error);
      }
      render(): JSX.Element {
        return this.state.failed ? <p id="outer">outer</p> : this.props.children;
      }
    }
    act(() => {
      root.render(
        <Outer>
          <LazyBoundary>
            <Lazy />
          </LazyBoundary>
        </Outer>,
      );
    });
    await settle();
    expect(host.querySelector('#outer')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect((seen[0] as Error).message).toBe('render failed');
  });
});
