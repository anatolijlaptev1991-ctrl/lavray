// SPDX-License-Identifier: GPL-3.0-only

// useImagePaste.ts — вставка картинки из буфера обмена (Ctrl+V). Реагирует
// только на файлы-картинки; вставленный текст не трогается и не
// перехватывается: на вкладке QR текстовых полей нет, ссылку вставляют на
// вкладке «Ссылка».
import { useEffect, useRef } from 'react';

/** Первая картинка из буфера: files (скриншот из «Ножниц») либо items. */
export function imageFromClipboard(data: DataTransfer | null): File | null {
  if (data === null) return null;
  const file = Array.from(data.files).find((f) => f.type.startsWith('image/'));
  if (file !== undefined) return file;
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return null;
}

/** Пока компонент смонтирован, картинка из буфера уходит в onImage. */
export function useImagePaste(onImage: (image: File) => void): void {
  const handler = useRef(onImage);
  handler.current = onImage;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const image = imageFromClipboard(e.clipboardData);
      if (image === null) return;
      e.preventDefault();
      handler.current(image);
    };
    document.addEventListener('paste', onPaste);
    return (): void => {
      document.removeEventListener('paste', onPaste);
    };
  }, []);
}
