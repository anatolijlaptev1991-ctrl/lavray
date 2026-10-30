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
import type { CoreClients } from '../lib/core';
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

const initialState = (profileId: bigint, name: string): CfState => ({
  profileId,
  name,
  phase: 'loading',
  preview: null,
  error: '',
  changed: false,
  acknowledged: false,
  busy: false,
});

/** Превью без исключений: итог — изменения состояния для patch(). */
async function fetchPreview(core: CoreClients, profileId: bigint, changed: boolean): Promise<Partial<CfState>> {
  try {
    const preview = await core.profiles.previewCustomFields({ profileId });
    return { phase: 'ready', preview, changed, acknowledged: false };
  } catch (e) {
    return { phase: 'error', preview: null, error: friendlyCoreError(e) };
  }
}

type Outcome =
  | { readonly kind: 'done'; readonly profile: Profile }
  | { readonly kind: 'stale' }
  | { readonly kind: 'failed'; readonly error: string };

/** ConfirmCustomFields с хэшем просмотренного превью; FAILED_PRECONDITION — «содержимое изменилось». */
async function submitConfirm(core: CoreClients, profileId: bigint, customHash: string): Promise<Outcome> {
  try {
    return { kind: 'done', profile: await core.profiles.confirmCustomFields({ profileId, customHash }) };
  } catch (e) {
    return isStale(e) ? { kind: 'stale' } : { kind: 'failed', error: friendlyCoreError(e) };
  }
}

type Patch = (change: Partial<CfState>) => void;

function toDialogProps(
  state: CfState,
  handlers: { readonly patch: Patch; readonly apply: () => Promise<void>; readonly close: () => void },
): CustomFieldsDialogProps {
  const { name, phase, preview, error, changed, acknowledged, busy } = state;
  return {
    name,
    phase,
    preview,
    error,
    changed,
    acknowledged,
    busy,
    onAcknowledge: (on: boolean): void => {
      handlers.patch({ acknowledged: on });
    },
    onApply: (): void => {
      void handlers.apply();
    },
    onClose: handlers.close,
  };
}

export function useCustomFieldsConfirm(options: CustomFieldsConfirmOptions = {}): CustomFieldsConfirm {
  const core = useCore();
  const [state, setState] = useState<CfState | null>(null);
  // seq отбрасывает ответы устаревших запросов (диалог закрыли или открыли заново),
  // active делает закрытие идемпотентным; опции читаются через ref, как в useModal.
  const seq = useRef(0);
  const active = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const patch: Patch = useCallback((change) => {
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
      const result = await fetchPreview(core, profileId, changed);
      if (mine === seq.current) patch(result);
    },
    [core, patch],
  );

  const open = useCallback(
    (profileId: bigint, name: string): void => {
      active.current = true;
      setState(initialState(profileId, name));
      void load(profileId, false);
    },
    [load],
  );

  const apply = useCallback(async (): Promise<void> => {
    if (state?.preview == null || !state.acknowledged || state.busy) return;
    const { profileId, preview } = state;
    const mine = ++seq.current;
    patch({ busy: true, error: '' });
    const outcome = await submitConfirm(core, profileId, preview.customHash);
    if (outcome.kind === 'done') optionsRef.current.onConfirmed?.(outcome.profile);
    if (mine !== seq.current) return; // диалог закрыли, пока ждали ядро
    if (outcome.kind === 'done') finish();
    else if (outcome.kind === 'stale') await load(profileId, true);
    else patch({ busy: false, error: outcome.error });
  }, [core, state, patch, load, finish]);

  const dialogProps =
    state === null ? null : toDialogProps(state, { patch, apply, close: finish });
  return { dialogProps, open, close: finish };
}
