// SPDX-License-Identifier: GPL-3.0-only

// testRequest.ts — виды проверки серверов (TCP-пинг, URL-тест, полный тест) и
// запрос TestLatency для каждого (T-84).
import type { MessageInitShape } from '@bufbuild/protobuf';
import { TestLatencyRequest_Mode } from '../gen/lavray_pb';
import type { TestLatencyRequestSchema } from '../gen/lavray_pb';

/** Проверки полного теста; поля соответствуют full_* запроса TestLatency. */
export interface FullTestOptions {
  readonly latency: boolean;
  readonly udp: boolean;
  readonly speed: boolean;
  readonly inOut: boolean;
}

/**
 * Что отмечено при открытии диалога: скорость выкачивает файл через каждый
 * сервер, поэтому включается осознанно.
 */
export const DEFAULT_FULL_TEST_OPTIONS: FullTestOptions = {
  latency: true,
  udp: true,
  speed: false,
  inOut: true,
};

/** Вид проверки: TCP-пинг, URL-тест или полный тест с выбранными проверками. */
export type TestRun =
  | { readonly kind: 'tcp' }
  | { readonly kind: 'url' }
  | { readonly kind: 'full'; readonly options: FullTestOptions };

/** Запрос TestLatency для вида проверки. */
export function testRequest(
  ids: readonly bigint[],
  run: TestRun,
): MessageInitShape<typeof TestLatencyRequestSchema> {
  const profileIds = [...ids];
  switch (run.kind) {
    case 'url':
      return { profileIds, mode: TestLatencyRequest_Mode.URL_TEST };
    case 'full':
      return {
        profileIds,
        mode: TestLatencyRequest_Mode.FULL_TEST,
        fullLatency: run.options.latency,
        fullUdpLatency: run.options.udp,
        fullSpeed: run.options.speed,
        fullInOutIp: run.options.inOut,
      };
    case 'tcp':
      return { profileIds, mode: TestLatencyRequest_Mode.TCP_PING };
  }
}
