// SPDX-License-Identifier: GPL-3.0-only

// agents.test.ts — MCP: режим доступа агентов и текст настройки клиентов.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { SettingValueSchema } from '../gen/lavray_pb';
import {
  AGENT_MODE_KEY,
  agentCorePath,
  claudeCodeCommand,
  claudeDesktopConfig,
  loadAgentMode,
  parseAgentMode,
  relayAgentMode,
} from './agents';
import { isAccessSettingKey, withoutSecrets } from './backup';
import type { CoreClients } from './core';

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }));

const WIN_PATH = 'C:\\Program Files\\LAVRay\\binaries\\lavray-core.exe';

describe('parseAgentMode', () => {
  it('понимает три режима, остальное считает выключенным', () => {
    expect(parseAgentMode('read')).toBe('read');
    expect(parseAgentMode('control')).toBe('control');
    expect(parseAgentMode('off')).toBe('off');
    for (const bad of ['', 'Read', 'admin', null, undefined, 1, true]) expect(parseAgentMode(bad)).toBe('off');
  });
});

describe('настройка для клиентов MCP', () => {
  it('JSON для Claude Desktop и Cursor: полный путь и аргумент mcp', () => {
    const json = claudeDesktopConfig(WIN_PATH);
    expect(JSON.parse(json)).toEqual({
      mcpServers: { lavray: { command: WIN_PATH, args: ['mcp'] } },
    });
    // обратные косые в JSON удвоены, иначе клиент прочитает неверный путь
    expect(json).toContain('"command": "C:\\\\Program Files\\\\LAVRay\\\\binaries\\\\lavray-core.exe"');
    expect(json).toContain('"args": [\n        "mcp"\n      ]');
  });

  it('строка для Claude Code', () => {
    expect(claudeCodeCommand(WIN_PATH)).toBe(
      'claude mcp add lavray -- "C:\\Program Files\\LAVRay\\binaries\\lavray-core.exe" mcp',
    );
  });
});

describe('режим в ядре', () => {
  const stringValue = (v: string): ReturnType<typeof create<typeof SettingValueSchema>> =>
    create(SettingValueSchema, { value: { case: 'stringValue', value: v } });

  it('читается из настройки agent.mode; нет значения или чужой тип — выключено', async () => {
    const getSettings = vi.fn().mockResolvedValue({ values: { [AGENT_MODE_KEY]: stringValue('control') } });
    const core = { settings: { getSettings } } as unknown as CoreClients;
    expect(await loadAgentMode(core)).toBe('control');
    expect(getSettings).toHaveBeenCalledWith({ keys: [AGENT_MODE_KEY] });

    getSettings.mockResolvedValue({ values: {} });
    expect(await loadAgentMode(core)).toBe('off');
    getSettings.mockResolvedValue({
      values: { [AGENT_MODE_KEY]: create(SettingValueSchema, { value: { case: 'boolValue', value: true } }) },
    });
    expect(await loadAgentMode(core)).toBe('off');
  });
});

describe('связь с оболочкой', () => {
  beforeEach(() => {
    shell.invoke.mockReset().mockResolvedValue(null);
  });
  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('вне оболочки режим не передаётся и путь неизвестен', async () => {
    await relayAgentMode('read');
    expect(await agentCorePath()).toBeNull();
    expect(shell.invoke).not.toHaveBeenCalled();
  });

  it('в оболочке: команды agent_access_set и agent_core_path', async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    await relayAgentMode('control');
    expect(shell.invoke).toHaveBeenCalledWith('agent_access_set', { mode: 'control' });

    shell.invoke.mockResolvedValueOnce(WIN_PATH);
    expect(await agentCorePath()).toBe(WIN_PATH);
    shell.invoke.mockRejectedValueOnce(new Error('ядро не найдено'));
    expect(await agentCorePath()).toBeNull();
    shell.invoke.mockResolvedValueOnce('');
    expect(await agentCorePath()).toBeNull();
  });
});

describe('копия настроек', () => {
  it('режим агентов в файл копии не попадает и из файла не восстанавливается', () => {
    expect(isAccessSettingKey('agent.mode')).toBe(true);
    expect(isAccessSettingKey('inbound.port')).toBe(false);
    expect(withoutSecrets({ 'agent.mode': 'control', 'inbound.port': 2080 })).toEqual({ 'inbound.port': 2080 });
  });
});
