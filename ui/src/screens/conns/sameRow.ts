// SPDX-License-Identifier: GPL-3.0-only

// sameRow.ts — когда строку таблицы соединений можно не перерисовывать.
import { equals } from '@bufbuild/protobuf';
import { ConnectionSchema } from '../../gen/lavray_pb';
import type { Connection } from '../../gen/lavray_pb';

export interface RowProps {
  readonly conn: Connection;
  /** Готовый текст длительности: строка не перерисовывается, пока он тот же. */
  readonly duration: string;
  readonly onMenu: (conn: Connection, anchor: never) => void;
}

/** Строка перерисовывается, только если изменилось содержимое соединения, длительность или обработчик. */
export function sameRow(prev: RowProps, next: RowProps): boolean {
  return (
    prev.duration === next.duration &&
    prev.onMenu === next.onMenu &&
    (prev.conn === next.conn || equals(ConnectionSchema, prev.conn, next.conn))
  );
}
