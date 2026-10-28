// dialog-portal.test.tsx — T-06 (F-047): диалоги рендерятся в портале на
// <body>, а не внутри экрана. После анимации .screen.active>* на предке
// остаётся transform, он делает предка containing block для position:fixed, и
// диалог центрировался по высоте списка серверов (вне окна 880×560).
// Геометрия и анимации в jsdom недоступны (а import '*.css?raw' в vitest
// возвращает пустую строку) — здесь проверяется структура DOM; размер окна и
// transform проверяет Playwright-сценарий из tasks/T-06.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import { Group_Kind, ProfileSchema, ProfileType } from '../gen/lavray_pb';
import { CoreContext } from '../hooks/useCore';
import type { CoreClients } from '../lib/core';
import { createCoreClients } from '../lib/core';
import { ServersScreen } from '../screens/screen_servers';
import { DialogShell } from './dialogs';
import { ImportDialog } from './ImportDialog';
import { ProfileEditor } from './ProfileEditor';

function setActEnvironment(on: boolean): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = on;
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe('T-06: диалоги живут в портале на <body>', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setActEnvironment(true);
    document.body.innerHTML = '';
    // host имитирует экран: <div class="screen active"><div class="srv">…</div></div>
    host = document.createElement('div');
    host.className = 'screen active';
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.innerHTML = '';
    setActEnvironment(false);
    vi.restoreAllMocks();
  });

  function render(el: ReactElement): void {
    act(() => {
      root.render(<div className="srv">{el}</div>);
    });
  }

  function expectInPortal(): void {
    const backs = document.querySelectorAll('.dlg-back');
    expect(backs).toHaveLength(1);
    const back = backs[0];
    expect(back?.parentElement, 'родитель .dlg-back — <body>').toBe(document.body);
    expect(host.contains(back ?? null), 'внутри экрана диалога нет').toBe(false);
    expect(document.querySelector('.srv .dlg-back')).toBeNull();
  }

  it('DialogShell', () => {
    render(
      <DialogShell titleId="t6Title" title="T-06" onClose={() => undefined}>
        <p>тело</p>
      </DialogShell>,
    );
    expectInPortal();
  });

  it('ImportDialog', () => {
    const clients = createCoreClients('http://127.0.0.1:1');
    render(
      <CoreContext.Provider value={clients}>
        <ImportDialog groupId={1n} onClose={() => undefined} onImported={() => undefined} />
      </CoreContext.Provider>,
    );
    expectInPortal();
  });

  it('ProfileEditor', () => {
    const clients = createCoreClients('http://127.0.0.1:1');
    render(
      <CoreContext.Provider value={clients}>
        <ProfileEditor profile={null} groupId={1n} onClose={() => undefined} onSaved={() => undefined} />
      </CoreContext.Provider>,
    );
    expectInPortal();
  });

  it('при размонтировании портал очищается', () => {
    render(
      <DialogShell titleId="t6Title" title="T-06" onClose={() => undefined}>
        <p>тело</p>
      </DialogShell>,
    );
    expect(document.querySelector('.dlg-back')).not.toBeNull();
    act(() => {
      root.render(<div className="srv" />);
    });
    expect(document.querySelector('.dlg-back')).toBeNull();
  });

  it('экран «Серверы»: редактор, «Группы», импорт и подтверждение удаления — вне .srv', async () => {
    const profile = create(ProfileSchema, {
      id: 1n,
      groupId: 5n,
      type: ProfileType.VMESS,
      name: 'Tokyo',
      address: 'jp.example.org',
      port: 443,
      geo: 'jp',
    });
    const clients = {
      profiles: {
        listGroups: vi.fn().mockResolvedValue({
          groups: [{ id: 5n, name: 'Default', kind: Group_Kind.BASIC, profileOrder: [1n] }],
        }),
        listProfiles: vi.fn().mockResolvedValue({ profiles: [profile], total: 1n }),
      },
    } as unknown as CoreClients;
    act(() => {
      root.render(
        <CoreContext.Provider value={clients}>
          <ServersScreen />
        </CoreContext.Provider>,
      );
    });
    await flush();
    await flush();

    const screen = host.querySelector('.srv');
    expect(screen, 'экран «Серверы» отрисован').not.toBeNull();
    expect(host.querySelector('.prow'), 'в списке есть строка сервера').not.toBeNull();

    const openAndCheck = async (open: () => void): Promise<void> => {
      act(open);
      await flush();
      const backs = document.querySelectorAll('.dlg-back');
      expect(backs.length, 'открыт ровно один диалог').toBe(1);
      expect(backs[0]?.parentElement).toBe(document.body);
      expect(screen?.contains(backs[0] ?? null), 'диалога нет внутри .srv').toBe(false);
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      // редактор (до T-40) Esc не закрывает — закрываем крестиком
      const close = document.querySelector<HTMLElement>('.dlg-back .dlg-h button');
      if (close) act(() => { close.click(); });
      await flush();
      expect(document.querySelector('.dlg-back')).toBeNull();
    };

    await openAndCheck(() => {
      host.querySelector<HTMLButtonElement>('.srv-actions .btn-pri')?.click(); // «Добавить» → редактор
    });
    await openAndCheck(() => {
      host.querySelector<HTMLButtonElement>('.srv-actions .btn-sec')?.click(); // «Импорт»
    });
    await openAndCheck(() => {
      Array.from(host.querySelectorAll<HTMLButtonElement>('.prof-toolbar button'))
        .find((b) => (b.textContent ?? '').trim() === 'Groups')
        ?.click(); // «Группы»
    });
    await openAndCheck(() => {
      host.querySelector<HTMLButtonElement>('.prow .prow-del')?.click(); // корзина строки → подтверждение
    });
  });
});
