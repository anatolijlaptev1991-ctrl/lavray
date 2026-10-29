// SPDX-License-Identifier: GPL-3.0-only

// AgentsSettings.tsx — строки раздела «Агенты (MCP)» в «Настройках»: режим
// доступа ИИ-агентов (выключено / только чтение / чтение и управление) с
// пояснением рисков и кнопки «Скопировать настройку» для Claude Desktop, Cursor
// и Claude Code. Режим хранит ядро и применяет сразу: запись делает экран
// настроек (onChange), а оболочке окно сообщает режим отдельной командой, чтобы
// она создала, изменила или убрала файл доступа.
import { useCallback, useState } from 'react';
import type { JSX } from 'react';
import { useI18n } from '../hooks/useI18n';
import {
  AGENT_MODES,
  agentCorePath,
  claudeCodeCommand,
  claudeDesktopConfig,
  relayAgentMode,
  type AgentMode,
} from '../lib/agents';
import type { MessageKey } from '../lib/i18n';
import { Icon } from './Icon';

/** Подписи вариантов режима. */
const MODE_LABEL: Readonly<Record<AgentMode, MessageKey>> = {
  off: 'agent.mode.off',
  read: 'agent.mode.read',
  control: 'agent.mode.control',
};

/** Как закончилось последнее действие. */
interface Note {
  readonly kind: 'ok' | 'err';
  readonly text: string;
}

interface Props {
  /** Режим, принятый ядром. */
  readonly mode: AgentMode;
  /** Записать режим в ядро; false — ядро отказало (причину показывает экран). */
  readonly onChange: (next: AgentMode) => Promise<boolean>;
}

export function AgentsSettings({ mode, onChange }: Props): JSX.Element {
  const { t, tf } = useI18n();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const change = useCallback(
    async (next: AgentMode): Promise<void> => {
      setBusy(true);
      setNote(null);
      try {
        if (!(await onChange(next))) return;
        try {
          await relayAgentMode(next);
        } catch (e) {
          setNote({ kind: 'err', text: tf('agent.shellFailed', { err: e instanceof Error ? e.message : String(e) }) });
        }
      } finally {
        setBusy(false);
      }
    },
    [onChange, tf],
  );

  const copy = useCallback(
    async (kind: 'config' | 'command'): Promise<void> => {
      setNote(null);
      const path = await agentCorePath();
      if (path === null) {
        setNote({ kind: 'err', text: t('agent.noPath') });
        return;
      }
      try {
        await navigator.clipboard.writeText(kind === 'config' ? claudeDesktopConfig(path) : claudeCodeCommand(path));
        setNote({ kind: 'ok', text: t(kind === 'config' ? 'agent.copied' : 'agent.copiedCode') });
      } catch {
        setNote({ kind: 'err', text: t('agent.copyFailed') });
      }
    },
    [t],
  );

  return (
    <>
      <div className="set-row">
        <div className="set-txt">
          <label className="set-l" htmlFor="agentMode">
            {t('agent.mode.l')}
          </label>
          <div className="set-d">{t('agent.mode.d')}</div>
          {mode === 'read' && (
            <div className="set-d" role="note">
              {t('agent.risk.read')}
            </div>
          )}
        </div>
        <div className="set-ctl">
          <select
            className="select"
            id="agentMode"
            value={mode}
            disabled={busy}
            onChange={(e) => {
              void change(e.target.value as AgentMode);
            }}
          >
            {AGENT_MODES.map((m) => (
              <option key={m} value={m}>
                {t(MODE_LABEL[m])}
              </option>
            ))}
          </select>
        </div>
      </div>
      {mode === 'control' && (
        <div className="banner banner-warn" role="note">
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">{t('agent.risk.control')}</div>
        </div>
      )}
      <div className="set-row">
        <div className="set-txt">
          <div className="set-l">{t('agent.copy')}</div>
          <div className="set-d">{t('agent.cfg.d')}</div>
        </div>
        <div className="set-ctl">
          <button
            className="btn btn-sec btn-sm"
            id="agentCopyConfig"
            onClick={() => {
              void copy('config');
            }}
          >
            {t('agent.copy')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            id="agentCopyCommand"
            onClick={() => {
              void copy('command');
            }}
          >
            {t('agent.copyCode')}
          </button>
        </div>
      </div>
      {note?.kind === 'err' && (
        <div className="banner banner-err" role="alert">
          <span className="ic">
            <Icon name="alert" />
          </span>
          <div className="bn-t">{note.text}</div>
        </div>
      )}
      {note?.kind === 'ok' && (
        <div className="toast-ok" role="status">
          {note.text}
        </div>
      )}
    </>
  );
}
