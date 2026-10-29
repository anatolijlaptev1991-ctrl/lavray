// SPDX-License-Identifier: GPL-3.0-only

// agents.ts — доступ ИИ-агентов (MCP). Режим хранит ядро (настройка agent.mode) и
// применяет сразу: пишет его экран «Настройки», читает при запуске useAgentAccess.
// Оболочка по сообщению окна создаёт, меняет или удаляет файл agent-endpoint.json.
// Здесь же — текст настройки для Claude Desktop, Cursor и Claude Code с полным
// путём к lavray-core.exe.
import type { CoreClients } from './core';

/** Режим доступа: выключено, только чтение, чтение и управление. */
export type AgentMode = 'off' | 'read' | 'control';

export const AGENT_MODES: readonly AgentMode[] = ['off', 'read', 'control'];

/** Ключ настройки ядра. */
export const AGENT_MODE_KEY = 'agent.mode';

/** Режим из значения настройки; всё непонятное — «выключено». */
export function parseAgentMode(value: unknown): AgentMode {
  return value === 'read' || value === 'control' ? value : 'off';
}

function inShell(): boolean {
  return (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

/** Режим из ядра. */
export async function loadAgentMode(core: CoreClients): Promise<AgentMode> {
  const res = await core.settings.getSettings({ keys: [AGENT_MODE_KEY] });
  const value = res.values[AGENT_MODE_KEY]?.value;
  return value?.case === 'stringValue' ? parseAgentMode(value.value) : 'off';
}

/** Сообщить режим оболочке: она создаёт, меняет или удаляет файл доступа. Вне оболочки ничего не делает. */
export async function relayAgentMode(mode: AgentMode): Promise<void> {
  if (!inShell()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('agent_access_set', { mode });
}

/** Полный путь к lavray-core.exe рядом с приложением; null — оболочки нет или ядро не найдено. */
export async function agentCorePath(): Promise<string | null> {
  if (!inShell()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<unknown>('agent_core_path');
    return typeof path === 'string' && path !== '' ? path : null;
  } catch {
    return null;
  }
}

/** Настройка для Claude Desktop (claude_desktop_config.json) и Cursor (mcp.json). */
export function claudeDesktopConfig(corePath: string): string {
  return JSON.stringify({ mcpServers: { lavray: { command: corePath, args: ['mcp'] } } }, null, 2);
}

/** Команда для Claude Code. */
export function claudeCodeCommand(corePath: string): string {
  return `claude mcp add lavray -- "${corePath}" mcp`;
}
