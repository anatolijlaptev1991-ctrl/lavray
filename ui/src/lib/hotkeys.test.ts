// hotkeys.test.ts — T-63: клавиша сочетания определяется в любой раскладке,
// подписи сочетаний содержат модификатор ОС.
import { describe, expect, it } from 'vitest';
import { hotkeyOf, kbdLabel, modLabel } from './hotkeys';

describe('hotkeyOf', () => {
  it('русская раскладка (ЙЦУКЕН): клавиша определяется по физическому положению', () => {
    expect(hotkeyOf({ key: 'л', code: 'KeyK' })).toBe('k');
    expect(hotkeyOf({ key: 'в', code: 'KeyD' })).toBe('d');
    expect(hotkeyOf({ key: 'Л', code: 'KeyK' })).toBe('k'); // Caps Lock
    expect(hotkeyOf({ key: 'б', code: 'Comma' })).toBe(',');
  });

  it('латинская раскладка: что напечатано, то и клавиша', () => {
    expect(hotkeyOf({ key: 'k', code: 'KeyK' })).toBe('k');
    expect(hotkeyOf({ key: 'K', code: 'KeyK' })).toBe('k');
    expect(hotkeyOf({ key: ',', code: 'Comma' })).toBe(',');
    // Dvorak: на физической KeyV напечатано «k» — это и есть сочетание Ctrl+K.
    expect(hotkeyOf({ key: 'k', code: 'KeyV' })).toBe('k');
  });

  it('цифры — в любой раскладке, в том числе на цифровом блоке', () => {
    expect(hotkeyOf({ key: '3', code: 'Digit3' })).toBe('3');
    expect(hotkeyOf({ key: '&', code: 'Digit1' })).toBe('1'); // AZERTY без Shift
    expect(hotkeyOf({ key: '5', code: 'Numpad5' })).toBe('5');
  });

  it('события без code (синтетические) работают по key', () => {
    expect(hotkeyOf({ key: '3', code: '' })).toBe('3');
    expect(hotkeyOf({ key: 'k', code: '' })).toBe('k');
  });

  it('служебные клавиши не опознаются', () => {
    expect(hotkeyOf({ key: 'Control', code: 'ControlLeft' })).toBe('');
    expect(hotkeyOf({ key: 'F5', code: 'F5' })).toBe('');
    expect(hotkeyOf({ key: 'Unidentified', code: '' })).toBe('');
  });
});

describe('подписи сочетаний (прототип kbdLabel)', () => {
  it('Windows/Linux/веб: «Ctrl+K»; macOS: «⌘K»; немецкий: «Strg+K»', () => {
    expect(kbdLabel('K', 'windows', 'ru')).toBe('Ctrl+K');
    expect(kbdLabel('D', 'linux', 'en')).toBe('Ctrl+D');
    expect(kbdLabel(',', 'web', 'zh')).toBe('Ctrl+,');
    expect(kbdLabel('K', 'macos', 'ru')).toBe('⌘K');
    expect(kbdLabel('K', 'windows', 'de')).toBe('Strg+K');
    expect(kbdLabel('K', 'macos', 'de')).toBe('⌘K');
  });

  it('Esc остаётся без модификатора', () => {
    expect(kbdLabel('Esc', 'windows', 'ru')).toBe('Esc');
    expect(kbdLabel('Esc', 'macos', 'en')).toBe('Esc');
  });

  it('modLabel', () => {
    expect(modLabel('mac', 'ru')).toBe('⌘');
    expect(modLabel('win', 'ru')).toBe('Ctrl');
  });
});
