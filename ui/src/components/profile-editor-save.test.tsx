// profile-editor-save.test.tsx — T-10 (F-006, B1-01, P0): «Сохранить» в
// редакторе профиля не стирает поля, которых нет в форме. Тест открывает
// настоящий ProfileEditor, меняет только имя (и одно-два видимых поля) и
// проверяет профиль, который уходит в UpdateProfile.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { create } from '@bufbuild/protobuf';
import {
  Hysteria2DetailSchema,
  ProfileSchema,
  ProfileType,
  ShadowsocksDetail_Uot,
  ShadowsocksDetailSchema,
  StreamSettings_MultiplexStatus,
  StreamSettings_Network,
  StreamSettings_PacketEncoding,
  StreamSettings_Security,
  StreamSettingsSchema,
  TrojanVlessDetailSchema,
  TuicDetail_CongestionControl,
  TuicDetail_UdpRelayMode,
  TuicDetailSchema,
} from '../gen/lavray_pb';
import type { Profile } from '../gen/lavray_pb';
import { CoreContext } from '../hooks/useCore';
import type { CoreClients } from '../lib/core';
import { ProfileEditor } from './ProfileEditor';

function setActEnvironment(on: boolean): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = on;
}

/** React-совместимая установка значения в controlled input. */
function setNativeValue(el: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const base = { id: 11n, groupId: 5n, name: 'Node', address: 'node.example.org', port: 443, favorite: true, tags: ['fast'] };

function hysteria2(): Profile {
  return create(ProfileSchema, {
    ...base,
    type: ProfileType.HYSTERIA2,
    detail: {
      case: 'hysteria2',
      value: create(Hysteria2DetailSchema, {
        password: 'hy-pass',
        obfsPassword: 'salamander-secret',
        serverPorts: '20000:30000',
        hopInterval: '30s',
        uploadMbps: 50,
        downloadMbps: 200,
        sni: 'hy.example.org',
        ca: '-----BEGIN CERTIFICATE-----',
        allowInsecure: true,
        disableSni: true,
      }),
    },
  });
}

function shadowsocks(): Profile {
  return create(ProfileSchema, {
    ...base,
    type: ProfileType.SHADOWSOCKS,
    detail: {
      case: 'shadowsocks',
      value: create(ShadowsocksDetailSchema, {
        method: 'aes-256-gcm',
        password: 'ss-pass',
        plugin: 'obfs-local;obfs=http;obfs-host=example.com',
        udpOverTcp: ShadowsocksDetail_Uot.V2,
      }),
    },
  });
}

function vless(): Profile {
  return create(ProfileSchema, {
    ...base,
    type: ProfileType.VLESS,
    detail: {
      case: 'trojanVless',
      value: create(TrojanVlessDetailSchema, {
        password: 'b831381d-6324-4d53-ad4f-8cda48b30811',
        flow: 'xtls-rprx-vision',
      }),
    },
    stream: create(StreamSettingsSchema, {
      network: StreamSettings_Network.WS,
      path: '/ws',
      host: 'ws.example.org',
      security: StreamSettings_Security.REALITY,
      sni: 'sni.example.org',
      utlsFingerprint: 'chrome',
      realityPublicKey: 'PBK',
      realityShortId: 'abcd',
      realitySpx: '/spx',
      wsEarlyDataHeader: 'Sec-WebSocket-Protocol',
      wsEarlyDataMax: 2048,
      certificate: 'CERT-PEM',
      headerType: 'http',
      packetEncoding: StreamSettings_PacketEncoding.XUDP,
      multiplex: StreamSettings_MultiplexStatus.MULTIPLEX_ON,
    }),
  });
}

function tuic(): Profile {
  return create(ProfileSchema, {
    ...base,
    type: ProfileType.TUIC,
    detail: {
      case: 'tuic',
      value: create(TuicDetailSchema, {
        uuid: 'b831381d-6324-4d53-ad4f-8cda48b30811',
        password: 'tuic-pass',
        congestionControl: TuicDetail_CongestionControl.CUBIC,
        udpRelayMode: TuicDetail_UdpRelayMode.QUIC,
        zeroRttHandshake: true,
        heartbeat: '10s',
        sni: 'tuic.example.org',
        alpn: 'h3',
        ca: 'CA-PEM',
        allowInsecure: true,
        udpOverStream: true,
      }),
    },
  });
}

describe('T-10: редактор не стирает поля вне формы при сохранении', () => {
  let container: HTMLDivElement;
  let root: Root;
  let updateProfile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActEnvironment(true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    updateProfile = vi.fn().mockResolvedValue({});
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
    setActEnvironment(false);
  });

  /** Открыть редактор, переименовать, нажать «Сохранить»; вернуть сохранённый профиль. */
  async function renameAndSave(profile: Profile, edit?: (dlg: HTMLElement) => void): Promise<Profile> {
    const clients = { profiles: { updateProfile } } as unknown as CoreClients;
    act(() => {
      root.render(
        <CoreContext.Provider value={clients}>
          <ProfileEditor profile={profile} groupId={5n} onClose={() => undefined} onSaved={() => undefined} />
        </CoreContext.Provider>,
      );
    });
    const dlg = document.querySelector<HTMLElement>('[role="dialog"]');
    if (dlg === null) throw new Error('редактор не открылся');
    // первое input.input в диалоге — «Название» (тип — select и отключён при правке)
    const name = dlg.querySelector<HTMLInputElement>('input.input');
    if (name === null) throw new Error('поле имени не найдено');
    act(() => {
      setNativeValue(name, 'Renamed');
    });
    if (edit) act(() => { edit(dlg); });
    await act(async () => {
      dlg.querySelector<HTMLButtonElement>('.btn-pri')?.click();
      await Promise.resolve(); // дать save() дойти до updateProfile
    });
    expect(updateProfile).toHaveBeenCalledTimes(1);
    const arg = updateProfile.mock.calls[0]?.[0] as { profile: Profile };
    return arg.profile;
  }

  it('Hysteria2: obfs, порты, скорости, CA и флаги сохраняются', async () => {
    const saved = await renameAndSave(hysteria2());
    expect(saved.name).toBe('Renamed');
    expect(saved.detail.case).toBe('hysteria2');
    if (saved.detail.case !== 'hysteria2') return;
    const d = saved.detail.value;
    expect(d.password).toBe('hy-pass');
    expect(d.obfsPassword).toBe('salamander-secret');
    expect(d.serverPorts).toBe('20000:30000');
    expect(d.hopInterval).toBe('30s');
    expect(d.uploadMbps).toBe(50);
    expect(d.downloadMbps).toBe(200);
    expect(d.sni).toBe('hy.example.org');
    expect(d.ca).toBe('-----BEGIN CERTIFICATE-----');
    expect(d.allowInsecure).toBe(true);
    expect(d.disableSni).toBe(true);
    // метаданные профиля тоже на месте
    expect(saved.groupId).toBe(5n);
    expect(saved.favorite).toBe(true);
    expect(saved.tags).toEqual(['fast']);
  });

  it('Hysteria2: изменённое в форме поле применяется, очищенное — очищается', async () => {
    const saved = await renameAndSave(hysteria2(), (dlg) => {
      const pass = dlg.querySelector<HTMLInputElement>('input[type="password"]');
      if (pass) setNativeValue(pass, 'new-pass');
      const sni = Array.from(dlg.querySelectorAll<HTMLLabelElement>('label.field'))
        .find((l) => l.querySelector('.cap')?.textContent === 'SNI')
        ?.querySelector('input');
      if (sni) setNativeValue(sni, '');
    });
    if (saved.detail.case !== 'hysteria2') throw new Error('ожидался hysteria2');
    expect(saved.detail.value.password).toBe('new-pass');
    expect(saved.detail.value.sni).toBeUndefined();
    expect(saved.detail.value.obfsPassword).toBe('salamander-secret');
  });

  it('Shadowsocks: plugin и UDP-over-TCP сохраняются', async () => {
    const saved = await renameAndSave(shadowsocks());
    expect(saved.name).toBe('Renamed');
    if (saved.detail.case !== 'shadowsocks') throw new Error('ожидался shadowsocks');
    expect(saved.detail.value.method).toBe('aes-256-gcm');
    expect(saved.detail.value.password).toBe('ss-pass');
    expect(saved.detail.value.plugin).toBe('obfs-local;obfs=http;obfs-host=example.com');
    expect(saved.detail.value.udpOverTcp).toBe(ShadowsocksDetail_Uot.V2);
  });

  it('VLESS: packet_encoding, multiplex, early data, certificate, reality_spx сохраняются', async () => {
    const saved = await renameAndSave(vless());
    expect(saved.name).toBe('Renamed');
    expect(saved.stream).toBeDefined();
    const s = saved.stream;
    if (s === undefined) return;
    expect(s.packetEncoding).toBe(StreamSettings_PacketEncoding.XUDP);
    expect(s.multiplex).toBe(StreamSettings_MultiplexStatus.MULTIPLEX_ON);
    expect(s.wsEarlyDataHeader).toBe('Sec-WebSocket-Protocol');
    expect(s.wsEarlyDataMax).toBe(2048);
    expect(s.certificate).toBe('CERT-PEM');
    expect(s.headerType).toBe('http');
    expect(s.realitySpx).toBe('/spx');
    // видимые поля транспорта на месте
    expect(s.network).toBe(StreamSettings_Network.WS);
    expect(s.path).toBe('/ws');
    expect(s.realityPublicKey).toBe('PBK');
    expect(s.realityShortId).toBe('abcd');
    if (saved.detail.case !== 'trojanVless') throw new Error('ожидался trojanVless');
    expect(saved.detail.value.flow).toBe('xtls-rprx-vision');
  });

  it('VLESS: очищенный в форме Public key REALITY очищается, а не возвращается из старого профиля', async () => {
    const saved = await renameAndSave(vless(), (dlg) => {
      const pbk = Array.from(dlg.querySelectorAll<HTMLLabelElement>('label.field'))
        .find((l) => l.querySelector('.cap')?.textContent === 'Public key')
        ?.querySelector('input');
      if (pbk) setNativeValue(pbk, '');
    });
    expect(saved.stream?.realityPublicKey).toBeUndefined();
    expect(saved.stream?.packetEncoding).toBe(StreamSettings_PacketEncoding.XUDP);
  });

  it('TUIC: congestion, udp relay, 0-RTT, heartbeat, CA сохраняются', async () => {
    const saved = await renameAndSave(tuic());
    expect(saved.name).toBe('Renamed');
    if (saved.detail.case !== 'tuic') throw new Error('ожидался tuic');
    const d = saved.detail.value;
    expect(d.password).toBe('tuic-pass');
    expect(d.congestionControl).toBe(TuicDetail_CongestionControl.CUBIC);
    expect(d.udpRelayMode).toBe(TuicDetail_UdpRelayMode.QUIC);
    expect(d.zeroRttHandshake).toBe(true);
    expect(d.heartbeat).toBe('10s');
    expect(d.sni).toBe('tuic.example.org');
    expect(d.alpn).toBe('h3');
    expect(d.ca).toBe('CA-PEM');
    expect(d.udpOverStream).toBe(true);
  });
});
