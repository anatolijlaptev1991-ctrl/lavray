// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from 'vitest';
import { serialQueue } from './serialQueue';

const later = <T>(ms: number, value: T, log: string[], tag: string): (() => Promise<T>) => () =>
  new Promise((resolve) => {
    log.push(`start ${tag}`);
    setTimeout(() => {
      log.push(`end ${tag}`);
      resolve(value);
    }, ms);
  });

describe('serialQueue', () => {
  it('runs_jobs_one_after_another_in_call_order', async () => {
    const q = serialQueue();
    const log: string[] = [];
    const a = q(later(30, 'on', log, 'enable'));
    const b = q(later(1, 'off', log, 'disable'));
    await expect(Promise.all([a, b])).resolves.toEqual(['on', 'off']);
    expect(log).toEqual(['start enable', 'end enable', 'start disable', 'end disable']);
  });

  it('a_failure_does_not_stop_the_queue', async () => {
    const q = serialQueue();
    const failed = q(() => Promise.reject(new Error('boom')));
    const next = q(() => Promise.resolve(42));
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe(42);
  });

  it('separate_queues_are_independent', async () => {
    const [q1, q2] = [serialQueue(), serialQueue()];
    const log: string[] = [];
    const slow = q1(later(30, 1, log, 'slow'));
    const fast = q2(later(1, 2, log, 'fast'));
    await Promise.all([slow, fast]);
    expect(log.indexOf('end fast')).toBeLessThan(log.indexOf('end slow'));
  });
});
