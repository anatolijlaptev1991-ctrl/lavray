// TypePicker.tsx — выбор типа профиля плитками в трёх группах (прототип
// #dlgEditor). Каждая группа — radiogroup: стрелки двигают выбор внутри группы,
// в Tab-порядок входит выбранная плитка (или первая плитка группы без выбора).
import type { JSX, KeyboardEvent } from 'react';
import type { ProfileType } from '../../gen/lavray_pb';
import type { MessageKey } from '../../lib/i18n';
import { TYPE_GROUPS, tileName } from './typeGroups';
import type { TileGroup } from './typeGroups';

interface Props {
  readonly value: ProfileType;
  readonly onChange: (type: ProfileType) => void;
  readonly t: (key: MessageKey) => string;
}

export function TypePicker({ value, onChange, t }: Props): JSX.Element {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, group: TileGroup): void => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const at = buttons.findIndex((b) => b === document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const next = (at + step + group.tiles.length) % group.tiles.length;
    const tile = group.tiles[next];
    if (tile === undefined) return;
    onChange(tile.type);
    buttons[next]?.focus();
  };

  return (
    <>
      {TYPE_GROUPS.map((group) => {
        const hasValue = group.tiles.some((x) => x.type === value);
        return (
          <div className="tg-group" key={group.id}>
            <span className="cap" id={`edTg-${group.id}`}>
              {t(group.labelKey)}
            </span>
            <div
              className="tg-grid"
              role="radiogroup"
              aria-labelledby={`edTg-${group.id}`}
              onKeyDown={(e) => {
                onKeyDown(e, group);
              }}
            >
              {group.tiles.map((tile, i) => {
                const on = tile.type === value;
                return (
                  <button
                    key={tile.type}
                    type="button"
                    className={`tg-opt${on ? ' on' : ''}`}
                    role="radio"
                    aria-checked={on}
                    tabIndex={on || (!hasValue && i === 0) ? 0 : -1}
                    onClick={() => {
                      onChange(tile.type);
                    }}
                  >
                    <span className="n">{tileName(tile, t)}</span>
                    <span className="c">
                      {tile.captionKey === undefined ? tile.caption : t(tile.captionKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
