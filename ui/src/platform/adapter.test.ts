import { describe, expect, it } from 'vitest';
import { detectOS, getPlatformAdapter, webAdapter } from './adapter';

describe('platform adapter (web default)', () => {
  it('selects the web adapter in a browser host', () => {
    const adapter = getPlatformAdapter(window);
    expect(adapter.id).toBe('web');
    // Web-стаб возвращается с детектированной ОС (spread), не тем же объектом.
    expect(adapter).toStrictEqual({ ...webAdapter, os: detectOS(window) });
  });

  it('reports all native capabilities as unavailable on web', () => {
    const caps = webAdapter.capabilities;
    expect(caps.tray).toBe(false);
    expect(caps.globalHotkeys).toBe(false);
    expect(caps.fileDialogs).toBe(false);
    expect(caps.windowControls).toBe(false);
    expect(caps.autostart).toBe(false);
    expect(caps.notifications).toBe(false);
  });

  it('stubs every native method without throwing', async () => {
    await expect(webAdapter.setTrayState('on')).resolves.toEqual({ kind: 'placeholder' });
    await expect(webAdapter.registerGlobalHotkey('Ctrl+Shift+L')).resolves.toBe(false);
    await expect(webAdapter.unregisterGlobalHotkey('Ctrl+Shift+L')).resolves.toBe(false);
    await expect(webAdapter.openFileDialog([])).resolves.toEqual({ path: null, canceled: true });
    await expect(webAdapter.saveFileDialog('backup.json', [])).resolves.toEqual({ path: null, canceled: true });
    await expect(webAdapter.showNotification('t', 'b')).resolves.toBe(false);
    expect(webAdapter.windowTheme()).toBeNull();
  });
});
