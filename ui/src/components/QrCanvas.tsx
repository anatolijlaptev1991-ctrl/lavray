// SPDX-License-Identifier: GPL-3.0-only

// QrCanvas.tsx — QR-код на <canvas>: чёрные модули на белом с тихой зоной в
// любой теме (на тёмном фоне инвертированный код читается не всеми
// сканерами). Для скринридера — role="img" и текстовая подпись.
import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import type { QrMatrix } from '../lib/qr/encode';
import { matrixToPixels } from '../lib/qr/raster';

interface Props {
  readonly matrix: QrMatrix;
  /** Подпись для скринридера: о какой ссылке этот код. */
  readonly label: string;
  /** Желаемая сторона в пикселях; модуль рисуется целым числом пикселей. */
  readonly size?: number;
}

/** Целый масштаб модуля, при котором код (с тихой зоной) не больше size. */
function moduleScale(modules: number, size: number): number {
  return Math.max(1, Math.floor(size / (modules + 8)));
}

export function QrCanvas({ matrix, label, size = 288 }: Props): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const scale = moduleScale(matrix.length, size);
  const side = (matrix.length + 8) * scale;

  useEffect(() => {
    const ctx = ref.current?.getContext('2d') ?? null;
    if (ctx === null) return;
    const { px, w, h } = matrixToPixels(matrix, scale);
    const image = ctx.createImageData(w, h);
    image.data.set(px);
    ctx.putImageData(image, 0, 0);
  }, [matrix, scale]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      width={side}
      height={side}
      style={{ width: side, maxWidth: '100%', height: 'auto', aspectRatio: '1 / 1', imageRendering: 'pixelated', borderRadius: 8 }}
    />
  );
}
