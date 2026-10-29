// SPDX-License-Identifier: GPL-3.0-only

/**
 * Application structure: 5 sections with their tabs (prototype `GROUPS`,
 * DS §7). The scaffold renders one stub screen per tab.
 */
import type { MessageKey } from '../lib/i18n';
import type { IconName } from '../components/Icon';

/** Tab label: either an i18n key or a literal ("DNS" is not translated). */
export type TabLabel = { readonly key: MessageKey } | { readonly literal: string };

export interface SectionTab {
  readonly id: string;
  readonly label: TabLabel;
  /** Screen subtitle key (scr.*.sub). */
  readonly subKey: MessageKey;
}

export interface Section {
  readonly id: string;
  /** Sidebar label key. */
  readonly navKey: MessageKey;
  readonly icon: IconName;
  readonly tabs: readonly SectionTab[];
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'connection',
    navKey: 'nav.connection',
    icon: 'zap',
    tabs: [{ id: 'connection', label: { key: 'nav.connection' }, subKey: 'scr.connection.sub' }],
  },
  {
    id: 'servers',
    navKey: 'nav.servers',
    icon: 'layers',
    tabs: [
      { id: 'profiles', label: { key: 'tab.servers' }, subKey: 'scr.profiles.sub' },
      { id: 'subscriptions', label: { key: 'nav.subscriptions' }, subKey: 'scr.subs.sub' },
    ],
  },
  {
    id: 'rules',
    navKey: 'nav.rules',
    icon: 'route',
    tabs: [
      { id: 'routing', label: { key: 'nav.routing' }, subKey: 'scr.routing.sub' },
      { id: 'dns', label: { literal: 'DNS' }, subKey: 'scr.dns.sub' },
    ],
  },
  {
    id: 'diag',
    navKey: 'nav.diag',
    icon: 'activity',
    tabs: [
      { id: 'checks', label: { key: 'tab.checks' }, subKey: 'scr.checks.sub' },
      { id: 'conns', label: { key: 'tab.conns' }, subKey: 'scr.conns.sub' },
      { id: 'log', label: { key: 'nav.log' }, subKey: 'scr.log.sub' },
    ],
  },
  {
    id: 'settings',
    navKey: 'nav.settings',
    icon: 'settings',
    tabs: [
      { id: 'settings', label: { key: 'tab.params' }, subKey: 'scr.settings.sub' },
      { id: 'updates', label: { key: 'nav.updates' }, subKey: 'scr.updates.sub' },
    ],
  },
];
