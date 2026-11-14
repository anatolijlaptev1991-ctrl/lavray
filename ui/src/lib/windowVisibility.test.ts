// SPDX-License-Identifier: GPL-3.0-only

// windowVisibility.test.ts — единый признак «окно скрыто в трей»: document.hidden,
// фокус + isVisible() окна Tauri, событие оболочки и «признак не залипает».
// Модули @tauri-apps/api не мокаются: подменяется мост __TAURI_INTERNALS__.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isWindowHidden,
  subscribeWindowHidden,
  WINDOW_VISIBILITY_EVENT,
} from "./windowVisibility";

function setDocHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

interface Bridge {
  /** Ответ на plugin:window|is_visible: значение, ошибка или зависший запрос. */
  visible: () => Promise<unknown>;
  fire: (event: string, payload: unknown) => void;
  calls: string[];
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i += 1)
    await new Promise<void>((r) => setTimeout(r, 10));
};

function installBridge(
  visible: () => Promise<unknown>,
  shellNow: () => Promise<unknown> = () => Promise.resolve(null),
): Bridge {
  const callbacks = new Map<number, (e: unknown) => void>();
  const byEvent = new Map<string, number[]>();
  const bridge: Bridge = {
    visible,
    calls: [],
    fire: (event, payload) => {
      (byEvent.get(event) ?? []).forEach((h) =>
        callbacks.get(h)?.({ event, id: 1, payload }),
      );
    },
  };
  let seq = 0;
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    transformCallback: (cb: (e: unknown) => void): number => {
      seq += 1;
      callbacks.set(seq, cb);
      return seq;
    },
    invoke: (
      cmd: string,
      args?: { event?: string; handler?: number },
    ): Promise<unknown> => {
      bridge.calls.push(cmd);
      if (cmd === "plugin:window|is_visible") return bridge.visible();
      if (cmd === "window_visible") return shellNow();
      if (
        cmd === "plugin:event|listen" &&
        args?.event !== undefined &&
        args.handler !== undefined
      ) {
        byEvent.set(args.event, [
          ...(byEvent.get(args.event) ?? []),
          args.handler,
        ]);
        return Promise.resolve(seq);
      }
      return Promise.resolve(null);
    },
  };
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (): void => undefined,
  };
  return bridge;
}

let stops: (() => void)[] = [];
const watch = (): ReturnType<typeof vi.fn> => {
  const l = vi.fn();
  stops.push(subscribeWindowHidden(l));
  return l;
};

beforeEach(() => {
  setDocHidden(false);
});
afterEach(() => {
  stops.forEach((s) => {
    s();
  });
  stops = [];
  const w = window as unknown as Record<string, unknown>;
  delete w.__TAURI_INTERNALS__;
  delete w.__TAURI_EVENT_PLUGIN_INTERNALS__;
  setDocHidden(false);
});

describe("windowVisibility: document.hidden", () => {
  it("visibilitychange сообщает о скрытии и показе; после отписки тишина", () => {
    const l = watch();
    expect(isWindowHidden()).toBe(false);
    setDocHidden(true);
    expect(isWindowHidden()).toBe(true);
    expect(l).toHaveBeenCalledTimes(1);
    setDocHidden(false);
    expect(l).toHaveBeenCalledTimes(2);
    stops.pop()?.();
    setDocHidden(true);
    expect(l).toHaveBeenCalledTimes(2);
  });

  it("повторное событие без смены признака не будит подписчиков", () => {
    const l = watch();
    setDocHidden(true);
    setDocHidden(true);
    expect(l).toHaveBeenCalledTimes(1);
  });
});

describe("windowVisibility: окно Tauri", () => {
  it("старт сразу в трее: isVisible() = false даёт «скрыто», хотя document.hidden = false", async () => {
    installBridge(() => Promise.resolve(false));
    const l = watch();
    await flush();
    expect(isWindowHidden()).toBe(true);
    expect(l).toHaveBeenCalledTimes(1);
  });

  it("потеря фокуса при видимом окне — не скрытие; при скрытом — скрытие; фокус возвращает видимость", async () => {
    let visible = true;
    const bridge = installBridge(() => Promise.resolve(visible));
    watch();
    await flush();
    expect(isWindowHidden()).toBe(false);

    bridge.fire("tauri://blur", null);
    await flush();
    expect(isWindowHidden()).toBe(false); // окно на виду, просто без фокуса

    visible = false;
    bridge.fire("tauri://blur", null);
    await flush();
    expect(isWindowHidden()).toBe(true);

    bridge.fire("tauri://focus", null);
    await flush();
    expect(isWindowHidden()).toBe(false);
  });

  it("событие оболочки window-visibility: false скрывает, true показывает", async () => {
    const bridge = installBridge(() => Promise.resolve(true));
    watch();
    await flush();
    bridge.fire(WINDOW_VISIBILITY_EVENT, false);
    expect(isWindowHidden()).toBe(true);
    bridge.fire(WINDOW_VISIBILITY_EVENT, true);
    expect(isWindowHidden()).toBe(false);
    bridge.fire(WINDOW_VISIBILITY_EVENT, "мусор");
    expect(isWindowHidden()).toBe(false);
  });

  it("нет разрешения на isVisible() или ответ не bool: опираемся на document.hidden", async () => {
    installBridge(() => Promise.reject(new Error("not allowed")));
    watch();
    await flush();
    expect(isWindowHidden()).toBe(false);
    setDocHidden(true);
    expect(isWindowHidden()).toBe(true);
    setDocHidden(false);
    stops.pop()?.();

    installBridge(() => Promise.resolve(undefined));
    watch();
    await flush();
    expect(isWindowHidden()).toBe(false);
  });

  it("признак не залипает: ввод пользователя и visibilitychange сбрасывают «скрыто»", async () => {
    const bridge = installBridge(() => Promise.resolve(false));
    watch();
    await flush();
    expect(isWindowHidden()).toBe(true);
    window.dispatchEvent(new Event("pointermove"));
    expect(isWindowHidden()).toBe(false);

    bridge.fire(WINDOW_VISIBILITY_EVENT, false);
    expect(isWindowHidden()).toBe(true);
    setDocHidden(true);
    setDocHidden(false);
    expect(isWindowHidden()).toBe(false);
  });

  it("запоздавший ответ isVisible() не отменяет более свежий фокус", async () => {
    let release: ((v: boolean) => void) | undefined;
    let first = true;
    const bridge = installBridge(() => {
      if (first) {
        first = false;
        return Promise.resolve(true);
      }
      return new Promise<boolean>((r) => {
        release = r;
      });
    });
    watch();
    await flush();
    bridge.fire("tauri://blur", null); // вопрос ушёл и завис
    bridge.fire("tauri://focus", null); // окно уже снова в фокусе
    release?.(false); // а ответ приходит «скрыто» с опозданием
    await flush();
    expect(isWindowHidden()).toBe(false);
  });

  it("вне оболочки (веб) мост не трогается", async () => {
    watch();
    await flush();
    expect(isWindowHidden()).toBe(false);
  });
});

describe("windowVisibility: событие оболочки как главный источник", () => {
  it("первое значение со старта: false скрывает, затем true показывает", async () => {
    const bridge = installBridge(() => Promise.resolve(true));
    const l = watch();
    await flush();
    bridge.fire(WINDOW_VISIBILITY_EVENT, false); // оболочка стартовала в трее
    expect(isWindowHidden()).toBe(true);
    expect(l).toHaveBeenCalledTimes(1);
    bridge.fire(WINDOW_VISIBILITY_EVENT, true);
    expect(isWindowHidden()).toBe(false);
    expect(l).toHaveBeenCalledTimes(2);
  });

  it("true со старта важнее document.hidden и isVisible() = false", async () => {
    const bridge = installBridge(() => Promise.resolve(false));
    watch();
    await flush(); // isVisible() ответил «скрыто»
    expect(isWindowHidden()).toBe(true);
    bridge.fire(WINDOW_VISIBILITY_EVENT, true);
    setDocHidden(true);
    expect(isWindowHidden()).toBe(false);
    bridge.fire("tauri://blur", null);
    await flush();
    expect(isWindowHidden()).toBe(false);
    bridge.fire(WINDOW_VISIBILITY_EVENT, false);
    expect(isWindowHidden()).toBe(true);
  });

  it("событие при загрузке ушло до подписки: команда window_visible даёт текущее значение", async () => {
    const bridge = installBridge(
      () => Promise.reject(new Error("нет разрешения")),
      () => Promise.resolve(false),
    );
    const l = watch();
    await flush();
    expect(bridge.calls).toContain("window_visible");
    expect(isWindowHidden()).toBe(true);
    expect(l).toHaveBeenCalledTimes(1);
  });

  it("событие, пришедшее после вопроса, важнее запоздавшего ответа window_visible", async () => {
    let answer: (v: unknown) => void = () => undefined;
    const bridge = installBridge(
      () => Promise.reject(new Error("нет разрешения")),
      () =>
        new Promise((r) => {
          answer = r;
        }),
    );
    watch();
    await flush();
    bridge.fire(WINDOW_VISIBILITY_EVENT, true);
    answer(false);
    await flush();
    expect(isWindowHidden()).toBe(false);
  });

  it("скрытие по событию не залипает: ввод пользователя возвращает «видно»", async () => {
    const bridge = installBridge(() => Promise.resolve(true));
    watch();
    await flush();
    bridge.fire(WINDOW_VISIBILITY_EVENT, false);
    expect(isWindowHidden()).toBe(true);
    window.dispatchEvent(new Event("keydown"));
    expect(isWindowHidden()).toBe(false);
  });
});
