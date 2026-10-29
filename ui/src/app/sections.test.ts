// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from 'vitest';
import { SECTIONS } from '../app/sections';
import { DICTIONARIES, LANGUAGES } from '../lib/i18n';

describe('app sections (prototype GROUPS)', () => {
  it('has exactly five sections in prototype order', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['connection', 'servers', 'rules', 'diag', 'settings']);
  });

  it('resolves every label key in every language', () => {
    for (const section of SECTIONS) {
      for (const lang of LANGUAGES) {
        expect(DICTIONARIES[lang][section.navKey], `${lang}:${section.navKey}`).toBeTruthy();
      }
      for (const tab of section.tabs) {
        if (!('key' in tab.label)) continue;
        for (const lang of LANGUAGES) {
          expect(DICTIONARIES[lang][tab.label.key], `${lang}:${tab.label.key}`).toBeTruthy();
        }
      }
    }
  });

  it('gives every section at least one tab with a subtitle', () => {
    for (const section of SECTIONS) {
      expect(section.tabs.length).toBeGreaterThan(0);
      for (const tab of section.tabs) {
        expect(DICTIONARIES.en[tab.subKey], `${section.id}/${tab.id}`).toBeTruthy();
      }
    }
  });
});
