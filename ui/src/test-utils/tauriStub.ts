// SPDX-License-Identifier: GPL-3.0-only

// tauriStub.ts — общая подставка оболочки Tauri для тестов UI: журнал вызовов
// invoke, ответы по командам (значение, ошибка, сырой ArrayBuffer, функция),
// переключатель window.__TAURI_INTERNALS__ и эмиттер событий, совместимый с
// listen из '@tauri-apps/api/event'. Подключается к модулям так (vi.mock
// поднимается выше импортов, поэтому подставка берётся динамическим import):
//
//   vi.mock('@tauri-apps/api/core', async () => (await import('../test-utils/tauriStub')).tauriCoreModule);
//   vi.mock('@tauri-apps/api/event', async () => (await import('../test-utils/tauriStub')).tauriEventModule);
//   beforeEach(() => { tauri.reset(); enableTauri(); });
//   afterEach(() => { disableTauri(); });
import type { Event as TauriEvent, EventCallback } from '@tauri-apps/api/event';

/** Один вызов invoke: команда и аргументы как их передал код. */
export interface TauriCall {
  readonly cmd: string;
  readonly args: unknown;
}

/** Ответ команды: вернуть значение (в том числе промис) либо бросить ошибку. */
export type CommandHandler = (args: unknown) => unknown;

type AnyListener = (event: TauriEvent<unknown>) => void;

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

/** Копия байтов как ArrayBuffer: так invoke отдаёт ответ tauri::ipc::Response. */
function toArrayBuffer(data: ArrayBuffer | Uint8Array | readonly number[]): ArrayBuffer {
  // Проверки по признакам, а не instanceof: в jsdom классы буферов «чужие» (другой realm).
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : 'byteLength' in data
      ? new Uint8Array(data)
      : Uint8Array.from(data);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export class TauriStub {
  private log: TauriCall[] = [];
  private handlers = new Map<string, CommandHandler>();
  private listeners = new Map<string, Map<number, AnyListener>>();
  private nextId = 1;

  /** Все вызовы по порядку, включая команды без обработчика. */
  get calls(): readonly TauriCall[] {
    return [...this.log];
  }

  /** Аргументы всех вызовов одной команды. */
  argsOf(cmd: string): unknown[] {
    return this.log.filter((c) => c.cmd === cmd).map((c) => c.args);
  }

  /** Команда отвечает функцией: возврат — значение (или промис), throw — отказ. */
  onCall(cmd: string, handler: CommandHandler): this {
    this.handlers.set(cmd, handler);
    return this;
  }

  /** Команда всегда отвечает этим значением. */
  onValue(cmd: string, value: unknown): this {
    return this.onCall(cmd, () => value);
  }

  /**
   * Команда отклоняется этим значением как есть: настоящая оболочка отдаёт
   * строку из Err(String), поэтому обычно error — строка.
   */
  onError(cmd: string, error: unknown): this {
    return this.onCall(cmd, () => {
      throw error;
    });
  }

  /** Команда отвечает сырыми байтами (ArrayBuffer), как tauri::ipc::Response. */
  onRaw(cmd: string, data: ArrayBuffer | Uint8Array | readonly number[]): this {
    return this.onCall(cmd, () => toArrayBuffer(data));
  }

  /** Подмена invoke из '@tauri-apps/api/core'. */
  async invoke<T>(cmd: string, args?: unknown): Promise<T> {
    this.log.push({ cmd, args });
    const handler = this.handlers.get(cmd);
    if (!handler) {
      throw new Error(`tauriStub: для команды "${cmd}" нет ответа; задайте его через onValue/onError/onRaw/onCall`);
    }
    return (await handler(args)) as T;
  }

  /** Подмена listen из '@tauri-apps/api/event'; отписка снимает только этого слушателя. */
  listen<T>(name: string, handler: EventCallback<T>): Promise<() => void> {
    const id = this.nextId++;
    const byId = this.listeners.get(name) ?? new Map<number, AnyListener>();
    byId.set(id, handler as AnyListener);
    this.listeners.set(name, byId);
    return Promise.resolve((): void => {
      byId.delete(id);
    });
  }

  /** Подмена once: слушатель снимается после первого события. */
  async once<T>(name: string, handler: EventCallback<T>): Promise<() => void> {
    const off = await this.listen<T>(name, (event) => {
      off();
      handler(event);
    });
    return off;
  }

  /** Событие от оболочки: слушатели вызываются сразу, по порядку подписки. */
  emit(name: string, payload?: unknown): number {
    const byId = this.listeners.get(name);
    if (!byId) return 0;
    const id = this.nextId++;
    const targets = [...byId.values()];
    for (const listener of targets) listener({ event: name, id, payload });
    return targets.length;
  }

  /** Сколько слушателей сейчас подписано на событие. */
  listenerCount(name: string): number {
    return this.listeners.get(name)?.size ?? 0;
  }

  /** Чистит журнал, ответы и подписки; window.__TAURI_INTERNALS__ тоже снимается. */
  reset(): void {
    this.log = [];
    this.handlers = new Map();
    this.listeners = new Map();
    this.nextId = 1;
    disableTauri();
  }
}

/** Общий экземпляр: на него смотрят модули-подставки ниже и тесты. */
export const tauri = new TauriStub();

/** Страница в окне Tauri: код берёт ветку «оболочка есть». */
export function enableTauri(): void {
  (window as TauriWindow).__TAURI_INTERNALS__ = {};
}

/** Веб-панель или браузер: оболочки нет. */
export function disableTauri(): void {
  delete (window as TauriWindow).__TAURI_INTERNALS__;
}

/** Фабрика для vi.mock('@tauri-apps/api/core'). */
export const tauriCoreModule = {
  invoke: <T>(cmd: string, args?: unknown): Promise<T> => tauri.invoke<T>(cmd, args),
};

/** Фабрика для vi.mock('@tauri-apps/api/event'). */
export const tauriEventModule = {
  listen: <T>(name: string, handler: EventCallback<T>): Promise<() => void> => tauri.listen<T>(name, handler),
  once: <T>(name: string, handler: EventCallback<T>): Promise<() => void> => tauri.once<T>(name, handler),
  emit: (name: string, payload?: unknown): Promise<void> => {
    tauri.emit(name, payload);
    return Promise.resolve();
  },
};
