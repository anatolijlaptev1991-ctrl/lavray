// SPDX-License-Identifier: GPL-3.0-only

// ProfileEditor.test.tsx — регрессия T-66: типы «Цепочка» и «Свой JSON» (группа
// «Особые»), поля Hy2/TUIC/SS, allowInsecure, подписи из словаря, название.
// @testing-library в проекте не установлен — react-dom/client + act и обычный DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import {
  ChainDetailSchema,
  Hysteria2DetailSchema,
  ProfileSchema,
  ProfileType,
  StreamSettings_Security,
} from '../gen/lavray_pb';
import type { Profile } from '../gen/lavray_pb';
import { CoreContext } from '../hooks/useCore';
import type { CoreClients } from '../lib/core';
import { setLanguage, t } from '../lib/i18n';
import { ProfileEditor } from './ProfileEditor';

const GROUP = 10n;

function candidate(id: number, name: string, type = ProfileType.VLESS): Profile {
  return create(ProfileSchema, { id: BigInt(id), groupId: GROUP, type, name, address: 'h.example.org', port: 443 });
}

interface Fake {
  readonly clients: CoreClients;
  readonly createProfile: Mock<(req: { profile: Profile }) => Promise<Profile>>;
  readonly updateProfile: Mock<(req: { profile: Profile }) => Promise<{ profile: Profile }>>;
}

function fakeClients(): Fake {
  const createProfile = vi.fn((req: { profile: Profile }) => Promise.resolve(req.profile));
  const updateProfile = vi.fn((req: { profile: Profile }) => Promise.resolve({ profile: req.profile }));
  const list = [candidate(1, 'Node A'), candidate(2, 'Node B', ProfileType.TROJAN), candidate(3, 'Existing chain', ProfileType.CHAIN)];
  const clients = {
    profiles: {
      createProfile,
      updateProfile,
      listProfiles: () => Promise.resolve({ profiles: list, total: BigInt(list.length) }),
    },
  } as unknown as CoreClients;
  return { clients, createProfile, updateProfile };
}

describe('ProfileEditor (T-66)', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setLanguage('ru');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function open(fake: Fake, profile: Profile | null = null): Promise<void> {
    act(() => {
      root?.render(
        createElement(
          CoreContext.Provider,
          { value: fake.clients },
          createElement(ProfileEditor, { profile, groupId: GROUP, onClose: vi.fn(), onSaved: vi.fn() }),
        ),
      );
    });
    await flush();
  }

  const text = (el: Element | null | undefined): string => (el?.textContent ?? '').trim();
  const byId = (id: string): HTMLElement => {
    const el = document.getElementById(id);
    if (el === null) throw new Error(`нет элемента #${id}`);
    return el;
  };
  const tile = (name: string): HTMLButtonElement | undefined =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) =>
      text(b.querySelector('.n')) === name,
    );

  /** Ввод в управляемое поле React: нативный setter + событие. */
  function type(id: string, value: string): void {
    const el = byId(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    act(() => {
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
  }

  function pick(name: string): void {
    const el = tile(name);
    expect(el, `плитка «${name}»`).toBeDefined();
    act(() => {
      el?.click();
    });
  }

  async function save(): Promise<void> {
    await act(async () => {
      Array.from(document.querySelectorAll('button'))
        .find((b) => text(b) === t('common.save'))
        ?.click();
      await Promise.resolve();
    });
    await flush();
  }

  it('тип выбирается плитками в трёх группах; «Цепочка» и «Свой JSON» — в «Особых»', async () => {
    await open(fakeClients());
    const groups = Array.from(document.querySelectorAll('.tg-group')).map((g) => ({
      label: text(g.querySelector('.cap')),
      tiles: Array.from(g.querySelectorAll('[role="radio"] .n')).map((n) => text(n)),
    }));
    expect(groups).toEqual([
      { label: t('ed.group.popular'), tiles: ['VLESS', 'Hysteria2', 'Trojan', 'Shadowsocks'] },
      { label: t('ed.group.other'), tiles: ['VMess', 'TUIC', 'SOCKS5', 'HTTPS'] },
      { label: t('ed.group.special'), tiles: [t('ed.t.chain'), t('ed.t.json')] },
    ]);
    // выбран ровно один тип (по умолчанию VMess), у него aria-checked
    expect(document.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(1);
  });

  it('стрелки двигают выбор внутри группы и переносят фокус', async () => {
    await open(fakeClients());
    pick('VLESS');
    const vless = tile('VLESS');
    act(() => {
      vless?.focus();
      vless?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(tile('Hysteria2')?.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(tile('Hysteria2'));
  });

  it('подпись над названием — «Название», а не «Имя подписки»; заголовок — «Новый профиль»', async () => {
    await open(fakeClients());
    expect(text(document.querySelector('label[for="edRemark"]'))).toBe(t('ed.remark'));
    expect(document.body.textContent).not.toContain(t('imp.name'));
    expect(text(document.querySelector('[role="dialog"] h2'))).toBe(t('ed.titleNew'));
  });

  it('нет английских подписей: Method, Security, Transport / TLS, Network, Path, Host, Public key, uTLS', async () => {
    await open(fakeClients());
    pick('VLESS');
    type('edf-tls', String(StreamSettings_Security.REALITY));
    const captions = Array.from(document.querySelectorAll('label, summary, .cap')).map((e) => text(e));
    for (const english of ['Method', 'Security', 'Transport / TLS', 'Network', 'Path', 'Host', 'Public key', 'uTLS', 'Alter ID']) {
      expect(captions, english).not.toContain(english);
    }
    expect(captions).toContain(t('ed.transportTls'));
    expect(captions).toContain(t('ed.publicKey'));
  });

  it('Hysteria2: поля obfs, скорость, hop, CA, insecure попадают в CreateProfile', async () => {
    const fake = fakeClients();
    await open(fake);
    pick('Hysteria2');
    type('edRemark', 'Hy2 server');
    type('edAddr', '203.0.113.7');
    type('edPort', '443');
    type('edf-password', 'pw');
    type('edf-obfs', 'obfs-secret');
    type('edf-up', '50');
    type('edf-down', '200');
    type('edf-ports', '20000:30000');
    type('edf-hop', '30s');
    type('edf-sni', 'hy.example.org');
    act(() => {
      byId('edf-insecure').click();
    });
    await save();
    expect(fake.createProfile).toHaveBeenCalledTimes(1);
    const sent = fake.createProfile.mock.calls[0]?.[0].profile;
    expect(sent?.type).toBe(ProfileType.HYSTERIA2);
    expect(sent?.detail).toMatchObject({
      case: 'hysteria2',
      value: {
        password: 'pw',
        obfsPassword: 'obfs-secret',
        uploadMbps: 50,
        downloadMbps: 200,
        serverPorts: '20000:30000',
        hopInterval: '30s',
        sni: 'hy.example.org',
        allowInsecure: true,
      },
    });
  });

  it('TUIC и Shadowsocks: congestion, relay, zero-rtt, плагин, UoT', async () => {
    const fake = fakeClients();
    await open(fake);
    pick('TUIC');
    type('edRemark', 'Tuic');
    type('edAddr', '203.0.113.8');
    type('edPort', '8443');
    type('edf-uuid', '12345678-90ab-cdef-1234-567890abcdef');
    type('edf-congestion', '2'); // cubic
    type('edf-relay', '2'); // quic
    type('edf-heartbeat', '10s');
    act(() => {
      byId('edf-zeroRtt').click();
    });
    await save();
    expect(fake.createProfile.mock.calls[0]?.[0].profile.detail).toMatchObject({
      case: 'tuic',
      value: { congestionControl: 2, udpRelayMode: 2, zeroRttHandshake: true, heartbeat: '10s' },
    });

    await open(fake);
    pick('Shadowsocks');
    type('edRemark', 'SS');
    type('edAddr', '203.0.113.9');
    type('edPort', '8388');
    type('edf-password', 'pw');
    type('edf-plugin', 'obfs-local;obfs=http');
    type('edf-uot', '2');
    await save();
    expect(fake.createProfile.mock.calls[1]?.[0].profile.detail).toMatchObject({
      case: 'shadowsocks',
      value: { plugin: 'obfs-local;obfs=http', udpOverTcp: 2 },
    });
  });

  it('VLESS: переключатель «Не проверять сертификат» пишет stream.allowInsecure', async () => {
    const fake = fakeClients();
    await open(fake);
    pick('VLESS');
    type('edRemark', 'V');
    type('edAddr', 'v.example.org');
    type('edPort', '443');
    type('edf-secret', '12345678-90ab-cdef-1234-567890abcdef');
    expect(byId('edf-insecure').getAttribute('aria-checked')).toBe('false');
    act(() => {
      byId('edf-insecure').click();
    });
    expect(byId('edf-insecure').getAttribute('aria-checked')).toBe('true');
    await save();
    expect(fake.createProfile.mock.calls[0]?.[0].profile.stream?.allowInsecure).toBe(true);
  });

  it('«Цепочка»: меньше двух узлов — ошибка без RPC; два узла в нужном порядке — CreateProfile', async () => {
    const fake = fakeClients();
    await open(fake);
    pick(t('ed.t.chain'));
    // адрес и порт у цепочки не запрашиваются
    expect(document.getElementById('edAddr')).toBeNull();
    type('edRemark', 'Chain');
    await save();
    expect(fake.createProfile).not.toHaveBeenCalled();
    expect(text(document.querySelector('.field-err'))).toBe(t('ed.chainMin'));

    // в списке узлов нет самой цепочки (chain-in-chain запрещён ядром)
    const options = Array.from((byId('edChainAdd') as HTMLSelectElement).options).map((o) => text(o));
    expect(options.some((o) => o.includes('Existing chain'))).toBe(false);
    type('edChainAdd', '2');
    type('edChainAdd', '1');
    const nodes = Array.from(document.querySelectorAll('.chain-node .n')).map((n) => text(n));
    expect(nodes).toEqual(['1. Node B', '2. Node A']);
    await save();
    expect(fake.createProfile).toHaveBeenCalledTimes(1);
    const sent = fake.createProfile.mock.calls[0]?.[0].profile;
    expect(sent?.type).toBe(ProfileType.CHAIN);
    expect(sent?.detail).toMatchObject({ case: 'chain', value: { profileIds: [2n, 1n] } });
  });

  it('существующая цепочка открывается с узлами и сохраняется (раньше — «SOCKS» и отказ сохранить)', async () => {
    const fake = fakeClients();
    const chain = create(ProfileSchema, {
      id: 9n,
      groupId: GROUP,
      type: ProfileType.CHAIN,
      name: 'My chain',
      detail: { case: 'chain', value: create(ChainDetailSchema, { profileIds: [1n, 2n] }) },
    });
    await open(fake, chain);
    expect(text(document.querySelector('.field .badge'))).toBe(t('ed.t.chain'));
    expect(document.getElementById('edAddr')).toBeNull();
    expect(Array.from(document.querySelectorAll('.chain-node .n')).map((n) => text(n))).toEqual([
      '1. Node A',
      '2. Node B',
    ]);
    await save();
    expect(fake.updateProfile).toHaveBeenCalledTimes(1);
    const sent = fake.updateProfile.mock.calls[0]?.[0].profile;
    expect(sent?.type).toBe(ProfileType.CHAIN);
    expect(sent?.detail).toMatchObject({ case: 'chain', value: { profileIds: [1n, 2n] } });
  });

  it('«Свой JSON»: невалидный JSON — ошибка у поля, валидный — CreateProfile с адресом из JSON', async () => {
    const fake = fakeClients();
    await open(fake);
    pick(t('ed.t.json'));
    type('edRemark', 'Custom');
    type('edf-json', '{ bad json');
    await save();
    expect(fake.createProfile).not.toHaveBeenCalled();
    expect(text(document.querySelector('.field-err'))).toMatch(new RegExp(`^${t('ed.jsonErr').split('{')[0] ?? ''}`));
    expect(byId('edf-json').getAttribute('aria-invalid')).toBe('true');

    type('edf-json', '{"type":"socks","server":"203.0.113.80","server_port":1081}');
    await save();
    const sent = fake.createProfile.mock.calls[0]?.[0].profile;
    expect(sent?.type).toBe(ProfileType.CUSTOM_OUTBOUND);
    expect([sent?.address, sent?.port]).toEqual(['203.0.113.80', 1081]);
    expect(sent?.detail).toMatchObject({ case: 'custom', value: { outboundJson: expect.stringContaining('203.0.113.80') as unknown } });
  });

  it('пустые обязательные поля подсвечиваются у поля, а не текстом пустого списка', async () => {
    const fake = fakeClients();
    await open(fake);
    await save();
    expect(fake.createProfile).not.toHaveBeenCalled();
    const errors = Array.from(document.querySelectorAll('.field.invalid .field-err')).map((e) => text(e));
    expect(errors).toEqual([t('ed.required'), t('ed.required'), t('ed.required')]);
    expect(document.body.textContent).not.toContain(t('srv.empty.d'));
    expect(document.activeElement?.id).toBe('edRemark');
  });

  it('правка существующего Hysteria2: тип зафиксирован, поля подставлены и сохраняются без потерь', async () => {
    const fake = fakeClients();
    const detail = create(Hysteria2DetailSchema, {
      password: 'pw',
      obfsPassword: 'obfs-secret',
      uploadMbps: 50,
      serverPorts: '20000:30000',
      hopInterval: '30s',
      allowInsecure: true,
    });
    const hy2 = create(ProfileSchema, {
      id: 7n,
      groupId: GROUP,
      type: ProfileType.HYSTERIA2,
      name: 'Hy2',
      address: 'h.example.org',
      port: 443,
      detail: { case: 'hysteria2', value: detail },
    });
    await open(fake, hy2);
    expect(document.querySelector('.tg-grid')).toBeNull(); // тип существующего профиля не меняется
    expect(text(document.querySelector('[role="dialog"] h2'))).toBe(t('ed.titleEdit'));
    expect((byId('edf-obfs') as HTMLInputElement).value).toBe('obfs-secret');
    await save();
    expect(fake.updateProfile).toHaveBeenCalledTimes(1);
    expect(fake.updateProfile.mock.calls[0]?.[0].profile.detail).toMatchObject({
      case: 'hysteria2',
      value: { obfsPassword: 'obfs-secret', uploadMbps: 50, serverPorts: '20000:30000', hopInterval: '30s', allowInsecure: true },
    });
  });

  it('editor_does_not_send_confirmed_true: ядро само считает подтверждение, редактор его не шлёт', async () => {
    const fake = fakeClients();
    await open(fake);
    pick('VLESS');
    type('edRemark', 'V');
    type('edAddr', 'v.example.org');
    type('edPort', '443');
    type('edf-secret', '12345678-90ab-cdef-1234-567890abcdef');
    await save();
    expect(fake.createProfile.mock.calls[0]?.[0].profile.customFieldsConfirmed).toBe(false);

    // правка профиля, у которого флаг уже true: он не переносится в запрос
    const confirmed = create(ProfileSchema, {
      ...candidate(5, 'Confirmed'),
      customFieldsConfirmed: true,
    });
    await open(fake, confirmed);
    await save();
    expect(fake.updateProfile.mock.calls[0]?.[0].profile.customFieldsConfirmed).toBe(false);
  });
});
