// SPDX-License-Identifier: GPL-3.0-only

// useQrImport.ts — поиск QR-кода по картинке (файл, буфер обмена) или по
// снимку экрана: состояние «ищем», сообщение о неудаче и защита от устаревших
// ответов. Найденный текст уходит в onDecoded — дальше работает обычный
// импорт ссылки (предпросмотр → «Добавить»).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { captureScreen } from '../../lib/qr/captureScreen';
import { findQr } from '../../lib/qr/scan';

export interface QrImport {
  readonly busy: boolean;
  /** Текст неудачи для показа ('' — всё хорошо). */
  readonly problem: string;
  readonly fromImage: (image: Blob) => void;
  readonly fromScreen: () => void;
}

/** Откуда пришёл отказ: картинка не читается или не снялся экран. */
type Source = 'image' | 'screen';

export function useQrImport(onDecoded: (text: string) => void): QrImport {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  // Последний запуск побеждает; после размонтирования ответ не применяется.
  const latest = useRef(0);
  useEffect(
    () => (): void => {
      latest.current = -1;
    },
    [],
  );
  const decoded = useRef(onDecoded);
  decoded.current = onDecoded;

  const run = useCallback(
    async (source: Source, search: () => Promise<string | null>): Promise<void> => {
      const mine = ++latest.current;
      setBusy(true);
      setProblem('');
      try {
        const text = (await search())?.trim() ?? '';
        if (latest.current !== mine) return;
        setBusy(false);
        if (text === '') setProblem(t('imp.qrNotFound'));
        else decoded.current(text);
      } catch (e) {
        if (latest.current !== mine) return;
        setBusy(false);
        setProblem(failText(source, e, t));
      }
    },
    [t],
  );

  const fromImage = useCallback((image: Blob): void => void run('image', () => findQr(image)), [run]);
  const fromScreen = useCallback(
    (): void =>
      void run('screen', async () => {
        const frame = await captureScreen();
        return frame === null ? null : findQr(frame);
      }),
    [run],
  );
  return { busy, problem, fromImage, fromScreen };
}

/** Текст отказа; строку из Err(String) оболочки показываем как подробность. */
function failText(source: Source, e: unknown, t: (key: 'imp.qrBadImage' | 'imp.qrCaptureFail') => string): string {
  const head = source === 'image' ? t('imp.qrBadImage') : t('imp.qrCaptureFail');
  return source === 'screen' && typeof e === 'string' && e !== '' ? `${head}: ${e.slice(0, 200)}` : head;
}
