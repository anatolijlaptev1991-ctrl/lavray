// SPDX-License-Identifier: GPL-3.0-only

// RuntimeConfigCard.test.tsx — «Показать текущий конфиг (без секретов)» в диагностике
// (GetRuntimeConfig): по кнопке, с подсказкой про маскирование, скрыть и копировать.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { setLanguage } from '../../lib/i18n';
import { Failure, click, mount, stubCore, unmountAll } from '../../test-utils/coreStub';
import { RuntimeConfigCard } from './RuntimeConfigCard';

const CONFIG = '{"outbounds":[{"type":"vless","server":"example.org","uuid":"***"}]}';

beforeEach(() => {
  setLanguage('en');
});

afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
});

const byText = (c: HTMLElement, text: string): HTMLElement | undefined =>
  Array.from(c.querySelectorAll<HTMLElement>('button')).find((b) => (b.textContent ?? '').trim() === text);

describe('RuntimeConfigCard', () => {
  it('до нажатия конфиг не запрашивается и не показывается (S)', async () => {
    const stub = stubCore({ 'CoreService/GetRuntimeConfig': { singBoxJson: CONFIG } });
    const view = await mount(createElement(RuntimeConfigCard));
    expect(stub.bodies('CoreService/GetRuntimeConfig')).toHaveLength(0);
    expect(view.container.querySelector('pre')).toBeNull();
    expect(byText(view.container, 'Show current config (without secrets)')).toBeDefined();
  });

  it('по кнопке показывает конфиг как есть (маскирует ядро) и подсказку', async () => {
    const stub = stubCore({ 'CoreService/GetRuntimeConfig': { singBoxJson: CONFIG } });
    const view = await mount(createElement(RuntimeConfigCard));
    await click(byText(view.container, 'Show current config (without secrets)'));
    expect(stub.bodies('CoreService/GetRuntimeConfig')).toHaveLength(1);
    expect(view.container.querySelector('pre')?.textContent).toBe(CONFIG);
    expect(view.container.querySelector('.cap')?.textContent).toMatch(/masked/i);
  });

  it('«Скрыть конфиг» убирает текст из страницы', async () => {
    stubCore({ 'CoreService/GetRuntimeConfig': { singBoxJson: CONFIG } });
    const view = await mount(createElement(RuntimeConfigCard));
    await click(byText(view.container, 'Show current config (without secrets)'));
    await click(byText(view.container, 'Hide config'));
    expect(view.container.querySelector('pre')).toBeNull();
    expect(view.container.textContent).not.toContain('example.org');
  });

  it('конфига ещё нет (ядро не запускалось) — подсказка «подключитесь», а не пустая рамка (E)', async () => {
    stubCore({ 'CoreService/GetRuntimeConfig': {} });
    const view = await mount(createElement(RuntimeConfigCard));
    await click(byText(view.container, 'Show current config (without secrets)'));
    expect(view.container.querySelector('pre')).toBeNull();
    expect(view.container.textContent).toContain('connect to a server');
  });

  it('«Копировать» кладёт в буфер тот же текст', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    stubCore({ 'CoreService/GetRuntimeConfig': { singBoxJson: CONFIG } });
    const view = await mount(createElement(RuntimeConfigCard));
    await click(byText(view.container, 'Show current config (without secrets)'));
    await click(byText(view.container, 'Copy'));
    expect(writeText).toHaveBeenCalledWith(CONFIG);
  });

  it('ошибка ядра показана, конфиг не выводится (R)', async () => {
    stubCore({ 'CoreService/GetRuntimeConfig': new Failure('unavailable', 'down') });
    const view = await mount(createElement(RuntimeConfigCard));
    await click(byText(view.container, 'Show current config (without secrets)'));
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
    expect(view.container.querySelector('pre')).toBeNull();
  });
});
