// SPDX-License-Identifier: GPL-3.0-only

// AgentsSettings.test.tsx — раздел «Агенты (MCP)» в «Настройках»: выбор режима с
// пояснением рисков, сообщение оболочке, копирование настройки для Claude Desktop,
// Cursor и Claude Code. Оболочка (Tauri) и буфер обмена подменены.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import type { JSX } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentMode } from '../lib/agents';
import { setLanguage, t } from '../lib/i18n';
import { click, flush } from '../test-harness';
import { AgentsSettings } from './AgentsSettings';

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));

const CORE_PATH = 'C:\\Program Files\\LAVRay\\binaries\\lavray-core.exe';

describe('AgentsSettings', () => {
  let container: HTMLDivElement;
  let unmount: () => void;
  const written: string[] = [];
  /** Что экран записал в ядро; accept=false — ядро отказывает. */
  const saved: AgentMode[] = [];
  let accept = true;

  /** Хозяин состояния, как экран настроек: режим принимает только после ответа ядра. */
  function Host(props: { initial: AgentMode }): JSX.Element {
    const [mode, setMode] = useState(props.initial);
    return createElement(AgentsSettings, {
      mode,
      onChange: (next: AgentMode): Promise<boolean> => {
        saved.push(next);
        if (accept) setMode(next);
        return Promise.resolve(accept);
      },
    });
  }

  async function mount(initial: AgentMode): Promise<void> {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    act(() => {
      root.render(createElement(Host, { initial }));
    });
    await flush(10);
    unmount = (): void => {
      act(() => {
        root.unmount();
      });
      container.remove();
    };
  }

  const select = (): HTMLSelectElement => container.querySelector<HTMLSelectElement>('#agentMode')!;

  async function choose(mode: string): Promise<void> {
    const el = select();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(el, mode);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(20);
  }

  beforeEach(() => {
    setLanguage('en');
    written.length = 0;
    saved.length = 0;
    accept = true;
    shell.invoke.mockReset().mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'agent_core_path' ? CORE_PATH : null),
    );
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn((text: string) => {
          written.push(text);
          return Promise.resolve();
        }),
      },
    });
  });
  afterEach(() => {
    unmount();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('по умолчанию выключено: три режима, предупреждений нет', async () => {
    await mount('off');
    expect(select().value).toBe('off');
    expect(Array.from(select().options).map((o) => o.textContent)).toEqual([
      t('agent.mode.off', 'en'),
      t('agent.mode.read', 'en'),
      t('agent.mode.control', 'en'),
    ]);
    expect(container.querySelector('.banner-warn')).toBeNull();
    expect(container.textContent).not.toContain(t('agent.risk.read', 'en'));
  });

  it('режим «только чтение» объясняет, что агент увидит', async () => {
    await mount('read');
    expect(select().value).toBe('read');
    expect(container.textContent).toContain(t('agent.risk.read', 'en'));
    expect(container.querySelector('.banner-warn')).toBeNull();
  });

  it('режим «чтение и управление» предупреждает о рисках и prompt injection', async () => {
    await mount('control');
    const warn = container.querySelector('.banner-warn')?.textContent ?? '';
    expect(warn).toContain(t('agent.risk.control', 'en'));
    expect(warn).toContain('prompt injection');
  });

  it('смена режима уходит в ядро, затем сообщается оболочке; предупреждение появляется сразу', async () => {
    await mount('off');
    await choose('control');
    expect(saved).toEqual(['control']);
    expect(shell.invoke).toHaveBeenCalledWith('agent_access_set', { mode: 'control' });
    expect(select().value).toBe('control');
    expect(container.querySelector('.banner-warn')).not.toBeNull();

    await choose('off');
    expect(saved).toEqual(['control', 'off']);
    expect(shell.invoke).toHaveBeenLastCalledWith('agent_access_set', { mode: 'off' });
    expect(container.querySelector('.banner-warn')).toBeNull();
  });

  it('ядро отказало: оболочке ничего не уходит, режим прежний', async () => {
    accept = false;
    await mount('off');
    await choose('control');
    expect(saved).toEqual(['control']);
    expect(select().value).toBe('off');
    expect(shell.invoke.mock.calls.filter(([cmd]) => cmd === 'agent_access_set')).toEqual([]);
  });

  it('оболочка не обновила файл: режим сохранён, причина показана', async () => {
    await mount('off');
    shell.invoke.mockImplementation((cmd: string) =>
      cmd === 'agent_access_set' ? Promise.reject(new Error('диск защищён')) : Promise.resolve(null),
    );
    await choose('read');
    expect(select().value).toBe('read');
    const err = container.querySelector('.banner-err')?.textContent ?? '';
    expect(err).toContain('диск защищён');
    expect(err).toContain(t('agent.shellFailed', 'en').split('{err}')[0]);
  });

  it('«Скопировать настройку» кладёт JSON с полным путём к lavray-core.exe', async () => {
    await mount('off');
    await click(container.querySelector('#agentCopyConfig'));
    expect(shell.invoke).toHaveBeenCalledWith('agent_core_path');
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0] ?? '')).toEqual({
      mcpServers: { lavray: { command: CORE_PATH, args: ['mcp'] } },
    });
    expect(container.textContent).toContain(t('agent.copied', 'en'));
  });

  it('«Команда для Claude Code» кладёт строку claude mcp add', async () => {
    await mount('read');
    await click(container.querySelector('#agentCopyCommand'));
    expect(written).toEqual([`claude mcp add lavray -- "${CORE_PATH}" mcp`]);
    expect(container.textContent).toContain(t('agent.copiedCode', 'en'));
  });

  it('путь к ядру неизвестен — понятное сообщение, буфер обмена не тронут', async () => {
    await mount('off');
    shell.invoke.mockImplementation(() => Promise.reject(new Error('не найдено')));
    await click(container.querySelector('#agentCopyConfig'));
    expect(written).toEqual([]);
    expect(container.querySelector('.banner-err')?.textContent).toContain(t('agent.noPath', 'en'));
  });

  it('буфер обмена недоступен — сообщение об ошибке копирования', async () => {
    await mount('off');
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('denied'));
    await click(container.querySelector('#agentCopyConfig'));
    expect(container.querySelector('.banner-err')?.textContent).toContain(t('agent.copyFailed', 'en'));
  });

  it('вне оболочки (браузер) режим уходит в ядро, оболочке не сообщается, копировать нечего', async () => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    await mount('off');
    await choose('read');
    expect(select().value).toBe('read');
    expect(shell.invoke).not.toHaveBeenCalled();
    await click(container.querySelector('#agentCopyConfig'));
    expect(container.querySelector('.banner-err')?.textContent).toContain(t('agent.noPath', 'en'));
  });
});
