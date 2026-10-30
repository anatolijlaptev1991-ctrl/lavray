// SPDX-License-Identifier: GPL-3.0-only

// useCustomFieldsConfirm.ts — подтверждение custom-полей профиля (T-08B): загрузка
// превью (PreviewCustomFields), согласие пользователя и ConfirmCustomFields с хэшем
// именно того содержимого, которое он видел. Если содержимое успело измениться
// (FAILED_PRECONDITION), превью загружается заново, а согласие сбрасывается.
// Хук отдаёт состояние для CustomFieldsDiffDialog; сам диалог рисует вызывающий.
import { useCallback, useRef, useState } from 'react';
import { Code, ConnectError } from '@connectrpc/connect';
import type { PreviewCustomFieldsResponse, Profile } from '../gen/lavray_pb';
import { friendlyCoreError } from '../lib/core';
import { useCore } from './useCore';

export type CfPhase = 'loading' | 'ready' | 'error';

interface CfState {
  readonly profileId: bigint;
  readonly name: string;
  readonly phase: CfPhase;
  readonly preview: PreviewCustomFieldsResponse | null;
  /** Текст ошибки ядра: загрузки превью (phase=error) или подтверждения (phase=ready). */
  readonly error: string;
  /** Содержимое изменилось после просмотра: показан новый diff, нужно подтвердить заново. */
  readonly changed: boolean;
  readonly acknowledged: boolean;
  readonly busy: boolean;
}

export interface CustomFieldsDialogProps {
  readonly name: string;
  readonly phase: CfPhase;
  readonly preview: PreviewCustomFieldsResponse | null;
  readonly error: string;
  readonly changed: boolean;
  readonly acknowledged: boolean;
  readonly busy: boolean;
  readonly onAcknowledge: (on: boolean) => void;
  readonly onApply: () => void;
  readonly onClose: () => void;
}

export interface CustomFieldsConfirmOptions {
  /** Ядро подтвердило содержимое; приходит обновлённый профиль. */
  readonly onConfirmed?: (profile: Profile) => void;
  /** Диалог закрыт любым способом: подтверждением, «Отмена», Esc. */
  readonly onClosed?: () => void;
}

export interface CustomFieldsConfirm {
  /** null — диалог закрыт. */
  readonly dialogProps: CustomFieldsDialogProps | null;
  readonly open: (profileId: bigint, name: string) => void;
  readonly close: () => void;
}

const isStale = (e: unknown): boolean => e instanceof ConnectError && e.code === Code.FailedPrecondition;

export function useCustomFieldsConfirm(options: CustomFieldsConfirmOptions = {}): CustomFieldsConfirm {
  const core = useCore();
  const [state, setState] = useState<CfState | null>(null);
  // seq отбрасывает ответы устаревших запросов (диалог закрыли или открыли заново),
  // active делает закрытие идемпотентным; опции читаются через ref, как в useModal.
  const seq = useRef(0);
  const active = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const patch = useCallback((change: Partial<CfState>): void => {
    setState((cur) => (cur === null ? cur : { ...cur, ...change }));
  }, []);

  const finish = useCallback((): void => {
    if (!active.current) return;
    active.current = false;
    seq.current += 1;
    setState(null);
    optionsRef.current.onClosed?.();
  }, []);

  const load = useCallback(
    async (profileId: bigint, changed: boolean): Promise<void> => {
      const mine = ++seq.current;
      patch({ phase: 'loading', error: '', busy: false });
      try {
        const preview = await core.profiles.previewCustomFields({ profileId });
        if (mine === seq.current) patch({ phase: 'ready', preview, changed, acknowledged: false });
      } catch (e) {
        if (mine === seq.current) patch({ phase: 'error', preview: null, error: friendlyCoreError(e) });
      }
    },
    [core, patch],
  );

  const open = useCallback(
    (profileId: bigint, name: string): void => {
      active.current = true;
      setState({
        profileId,
        name,
        phase: 'loading',
        preview: null,
        error: '',
        changed: false,
        acknowledged: false,
        busy: false,
      });
      void load(profileId, false);
    },
    [load],
  );

  const apply = useCallback(async (): Promise<void> => {
    if (state?.preview == null || !state.acknowledged || state.busy) return;
    const { profileId, preview } = state;
    const mine = ++seq.current;
    patch({ busy: true, error: '' });
    try {
      const profile = await core.profiles.confirmCustomFields({ profileId, customHash: preview.customHash });
      optionsRef.current.onConfirmed?.(profile);
      if (mine === seq.current) finish();
    } catch (e) {
      if (mine !== seq.current) return;
      if (isStale(e)) await load(profileId, true);
      else patch({ busy: false, error: friendlyCoreError(e) });
    }
  }, [core, state, patch, load, finish]);

  const dialogProps: CustomFieldsDialogProps | null =
    state === null
      ? null
      : {
          name: state.name,
          phase: state.phase,
          preview: state.preview,
          error: state.error,
          changed: state.changed,
          acknowledged: state.acknowledged,
          busy: state.busy,
          onAcknowledge: (on: boolean): void => {
            patch({ acknowledged: on });
          },
          onApply: (): void => {
            void apply();
          },
          onClose: finish,
        };
  return { dialogProps, open, close: finish };
}
