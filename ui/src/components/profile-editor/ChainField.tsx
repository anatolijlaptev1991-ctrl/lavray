// ChainField.tsx — узлы цепочки (прототип chainEditorHtml): упорядоченный
// список профилей с «выше / ниже / убрать» и добавлением узла из списка.
// Порядок сверху вниз = порядок трафика (ChainDetail.profile_ids). Цепочку в
// цепочку и сам профиль добавить нельзя: ядро отвергает chain-in-chain.
import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { ProfileType } from '../../gen/lavray_pb';
import type { Profile } from '../../gen/lavray_pb';
import { useCore } from '../../hooks/useCore';
import { useI18n } from '../../hooks/useI18n';
import { Icon } from '../Icon';
import { typeDisplayName } from './typeGroups';

interface Props {
  readonly value: readonly bigint[];
  readonly onChange: (ids: bigint[]) => void;
  /** id редактируемого профиля (0n у нового): его в узлы не предлагаем. */
  readonly selfId: bigint;
  readonly error?: string | undefined;
}

export function ChainField({ value, onChange, selfId, error }: Props): JSX.Element {
  const { t } = useI18n();
  const core = useCore();
  const [all, setAll] = useState<readonly Profile[]>([]);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const res = await core.profiles.listProfiles({});
        setAll(res.profiles);
      } catch {
        /* список недоступен: узлы показываются по номеру профиля */
      }
    })();
  }, [core]);

  const byId = useMemo(() => new Map(all.map((p) => [p.id, p])), [all]);
  const candidates = all.filter((p) => p.type !== ProfileType.CHAIN && p.id !== selfId);

  const move = (from: number, to: number): void => {
    const next = [...value];
    const [item] = next.splice(from, 1);
    if (item === undefined) return;
    next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <div className={`field span2${error === undefined ? '' : ' invalid'}`}>
      <span className="set-l" id="edChainL">
        {t('ed.chainNodes')}
      </span>
      <div className="chain-list" role="list" aria-labelledby="edChainL">
        {value.map((id, i) => {
          const profile = byId.get(id);
          return (
            <div className="chain-node" role="listitem" key={`${String(id)}-${String(i)}`}>
              <span className="n">
                {String(i + 1)}. {profile === undefined ? `#${String(id)}` : profile.name}
              </span>
              <button
                type="button"
                className="btn btn-ic btn-sm"
                aria-label={t('ed.chainUp')}
                title={t('ed.chainUp')}
                disabled={i === 0}
                onClick={() => {
                  move(i, i - 1);
                }}
              >
                <Icon name="arrup" size={16} />
              </button>
              <button
                type="button"
                className="btn btn-ic btn-sm"
                aria-label={t('ed.chainDown')}
                title={t('ed.chainDown')}
                disabled={i === value.length - 1}
                onClick={() => {
                  move(i, i + 1);
                }}
              >
                <Icon name="arrdown" size={16} />
              </button>
              <button
                type="button"
                className="btn btn-ic btn-sm"
                aria-label={t('ed.chainRemove')}
                title={t('ed.chainRemove')}
                onClick={() => {
                  onChange(value.filter((_, at) => at !== i));
                }}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          );
        })}
      </div>
      <select
        className="select"
        id="edChainAdd"
        aria-label={t('ed.chainAdd')}
        value=""
        onChange={(e) => {
          if (e.target.value !== '') onChange([...value, BigInt(e.target.value)]);
        }}
      >
        <option value="">+ {t('ed.chainAdd')}</option>
        {candidates.map((p) => (
          <option key={String(p.id)} value={String(p.id)}>
            {p.name} · {typeDisplayName(p.type, t)}
          </option>
        ))}
      </select>
      {error !== undefined && <span className="field-err">{error}</span>}
    </div>
  );
}
