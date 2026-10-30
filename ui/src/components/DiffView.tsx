// SPDX-License-Identifier: GPL-3.0-only

// DiffView.tsx — unified diff построчно, моноширинным шрифтом, с номерами старой и новой
// строки. Добавленные и удалённые строки различаются не только цветом (токены --ok/--err),
// но и знаком «+» / «−»: цвет не единственный признак. Область прокручивается, поэтому
// она фокусируется с клавиатуры (role="region" с подписью).
import { useMemo } from 'react';
import type { JSX } from 'react';
import { parseUnifiedDiff } from '../lib/unifiedDiff';
import type { DiffLine } from '../lib/unifiedDiff';

/** Знак в колонке: у контекста пусто, но колонка остаётся (CSS задаёт ширину). */
const SIGN: Readonly<Record<DiffLine['kind'], string>> = {
  add: '+',
  del: '−',
  ctx: '',
  file: '',
  hunk: '',
  meta: '',
};

const isBody = (line: DiffLine): boolean =>
  line.kind === 'add' || line.kind === 'del' || line.kind === 'ctx';

function Row({ line }: { readonly line: DiffLine }): JSX.Element {
  return (
    <div className={`df-l df-${line.kind}`}>
      {isBody(line) && (
        <>
          <span className="df-no" aria-hidden="true">
            {line.oldNo}
          </span>
          <span className="df-no" aria-hidden="true">
            {line.newNo}
          </span>
          <span className="df-sg">{SIGN[line.kind]}</span>
        </>
      )}
      <span className="df-tx">{line.text}</span>
    </div>
  );
}

interface Props {
  /** Текст unified diff от ядра (секреты уже замаскированы ядром). */
  readonly diff: string;
  /** Доступное имя области. */
  readonly label: string;
}

export function DiffView({ diff, label }: Props): JSX.Element {
  const lines = useMemo(() => parseUnifiedDiff(diff), [diff]);
  return (
    <div className="diffv" role="region" aria-label={label} tabIndex={0}>
      {lines.map((line, i) => (
        // Строки неизменны и без собственного id: порядок в diff и есть идентичность.
        <Row key={i} line={line} />
      ))}
    </div>
  );
}
