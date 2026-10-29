// SPDX-License-Identifier: GPL-3.0-only

// profileMerge.ts — слияние значений формы редактора с исходным профилем (T-10).
//
// UpdateProfile — ПОЛНАЯ замена профиля. Форма редактора знает только часть
// полей: у Hysteria2 нет obfs/портов/скоростей/CA, у Shadowsocks — plugin и
// UDP-over-TCP, у потока (stream) — packet_encoding/multiplex/early data.
// Если собрать профиль заново из формы, при любом сохранении (даже смене
// имени) эти поля стираются и рабочий сервер перестаёт работать (B1-01).
//
// Правило: значения, которые пользователь видит и может менять, берутся из
// формы (в том числе пустые — так их можно очистить); всё, чего в форме нет,
// берётся из исходного профиля. Когда поле появится в форме, его нужно
// перенести из «сохраняемых» в «формовые» в нужной функции ниже.
import { create } from '@bufbuild/protobuf';
import {
  Hysteria2DetailSchema,
  ShadowsocksDetailSchema,
  StreamSettingsSchema,
  TuicDetailSchema,
} from '../gen/lavray_pb';
import type { Profile, StreamSettings } from '../gen/lavray_pb';

/**
 * Слияние типоспецифичной части (oneof detail).
 *
 * - форма не дала detail (цепочка, свой JSON и другие типы без формы) —
 *   остаётся исходный;
 * - другой тип detail — берётся из формы целиком;
 * - Hysteria2 / Shadowsocks / TUIC — поля формы поверх исходного detail;
 * - SOCKS/HTTP, VMess, VLESS/Trojan: в форме есть все поля сообщения,
 *   значение из формы целиком.
 */
export function mergeDetail(old: Profile['detail'], next: Profile['detail']): Profile['detail'] {
  if (next.case === undefined) return old;
  if (old.case !== next.case) return next;
  if (old.case === 'hysteria2' && next.case === 'hysteria2') {
    // Форма: пароль, SNI. Сохраняются: obfs_password, upload/download_mbps,
    // server_ports, hop_interval, ca, allow_insecure, disable_sni.
    return {
      case: 'hysteria2',
      value: create(Hysteria2DetailSchema, {
        ...old.value,
        password: next.value.password,
        sni: next.value.sni,
      }),
    };
  }
  if (old.case === 'shadowsocks' && next.case === 'shadowsocks') {
    // Форма: метод, пароль. Сохраняются: plugin, udp_over_tcp.
    return {
      case: 'shadowsocks',
      value: create(ShadowsocksDetailSchema, {
        ...old.value,
        method: next.value.method,
        password: next.value.password,
      }),
    };
  }
  if (old.case === 'tuic' && next.case === 'tuic') {
    // Форма: UUID, пароль. Сохраняются: congestion_control, udp_relay_mode,
    // zero_rtt_handshake, heartbeat, sni, alpn, ca, allow_insecure,
    // disable_sni, udp_over_stream.
    return {
      case: 'tuic',
      value: create(TuicDetailSchema, {
        ...old.value,
        uuid: next.value.uuid,
        password: next.value.password,
      }),
    };
  }
  return next;
}

/**
 * Слияние транспорта/TLS. Форма: network, path, host, security, sni, alpn,
 * allow_insecure, utls_fingerprint, reality_public_key, reality_short_id.
 * Сохраняются: header_type, ws_early_data_*, certificate, reality_spx,
 * packet_encoding, multiplex.
 */
export function mergeStream(
  old: StreamSettings | undefined,
  next: StreamSettings | undefined,
): StreamSettings | undefined {
  if (old === undefined) return next;
  // Тип без транспорта в форме (Hysteria2, TUIC, Shadowsocks) — как был.
  if (next === undefined) return old;
  return create(StreamSettingsSchema, {
    ...old,
    network: next.network,
    path: next.path,
    host: next.host,
    security: next.security,
    sni: next.sni,
    alpn: next.alpn,
    allowInsecure: next.allowInsecure,
    utlsFingerprint: next.utlsFingerprint,
    realityPublicKey: next.realityPublicKey,
    realityShortId: next.realityShortId,
  });
}
