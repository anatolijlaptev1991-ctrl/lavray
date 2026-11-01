// SPDX-License-Identifier: GPL-3.0-only

// ReleaseNotes.tsx — «Что нового» (T-75). ТОЛЬКО текст: заметки приходят из
// манифеста как markdown, но здесь они выводятся текстовым узлом React с
// сохранением переносов строк. Никакого innerHTML и разбора разметки: теги и
// обработчики из заметок остаются обычными символами на экране.
import type { JSX } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { pickNotes } from '../../lib/updates/appUpdate';

export function ReleaseNotes({ notes }: { readonly notes: Readonly<Record<string, string>> }): JSX.Element | null {
  const { t, lang } = useI18n();
  const text = pickNotes(notes, lang);
  if (text === '') return null;
  return (
    <section aria-labelledby="updNotesTitle" style={{ marginTop: 8 }}>
      <p className="cap" id="updNotesTitle">
        {t('upd.whatsNew')}
      </p>
      <div className="upd-notes" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '.8125rem' }}>
        {text}
      </div>
    </section>
  );
}
