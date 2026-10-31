// SPDX-License-Identifier: GPL-3.0-only

// BrandMark.tsx — знак бренда «Отражение». Вынесен из Icon.tsx (размерная
// трещотка): сам знак не менялся, Icon.tsx по-прежнему его реэкспортирует.
import { useId } from 'react';
import type { JSX } from 'react';

/** BrandMark — знак «Отражение» (DS v1.2): L-луч, зеркало 45°, фотон.
 *  Геометрия скопирована из прототипа (design/prototype.html, .lgA).
 *
 *  Идентификаторы градиентов уникальны для каждого экземпляра: знак
 *  встречается несколько раз на экране, а `id` в SVG глобальны — при
 *  повторах браузер разрешал `url(#lavRay)` в первый (скрытый в веб-режиме
 *  титлбар) элемент, и луч не закрашивался. */
export function BrandMark({ size = 24 }: { readonly size?: number }): JSX.Element {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const solid = `ray-${uid}`;
  return (
    <svg
      className="lgA lgA-sm"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {/* Градиент луча «Отражение» (прототип, design/prototype.html:975-984):
          единственное место, где градиенты разрешены (DS §2). */}
      <defs>
        <linearGradient id={solid} gradientUnits="userSpaceOnUse" x1="23" y1="9" x2="49" y2="43">
          <stop offset="0" className="lr-a" />
          <stop offset="1" className="lr-b" />
        </linearGradient>
      </defs>
      <g transform="translate(-4.5 1.5)">
        {/* stroke инлайном перекрывает url(#lavRaySolid) из .lgA-sm .a-beam */}
        <path
          className="a-beam"
          d="M23 13V43H45"
          strokeWidth="10"
          style={{ stroke: `url(#${solid})` }}
        />
        <circle className="a-photon" cx="56.5" cy="43" r="5" />
      </g>
    </svg>
  );
}
