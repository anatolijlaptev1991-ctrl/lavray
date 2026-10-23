/**
 * LAVRay platform adapter (stage-3 scaffold).
 *
 * One UI runs in two shells (ui/README.md): a desktop app (Tauri, later)
 * and the web panel. All native-only capabilities live behind this
 * interface; the web implementation is the default and reports every
 * capability as unavailable.
 *
 * Extension point for Tauri (do NOT import `@tauri-apps/*` here yet):
 * implement `PlatformAdapter` with IPC calls in `src/platform/tauri.ts`
 * and select it in `getPlatformAdapter()` when
 * `window.__TAURI_INTERNALS__` is present.
 */

export interface Capabilities {
  /** Native window tray icon and menu. */
  readonly tray: boolean;
  /** Global (system-wide) keyboard shortcuts. */
  readonly globalHotkeys: boolean;
  /** Native file open/save dialogs. */
  readonly fileDialogs: boolean;
  /** Window controls (minimize/maximize/close chrome). */
  readonly windowControls: boolean;
  /** OS autostart registration. */
  readonly autostart: boolean;
  /** OS notifications. */
  readonly notifications: boolean;
}

export type WindowTheme = 'dark' | 'light';

export interface TrayMenuPlaceholder {
  readonly kind: 'placeholder';
}

/** File-filter descriptor for dialogs (platform-agnostic subset). */
export interface FileFilter {
  readonly name: string;
  readonly extensions: readonly string[];
}

export interface OpenFileResult {
  /** Absolute path (native) or File object reference id (web fallback). */
  readonly path: string | null;
  readonly canceled: boolean;
}

/**
 * Platform surface used by the UI. Every method is a stub at this stage;
 * the shape is the contract for the Tauri implementation.
 */
export type HostOS = 'windows' | 'macos' | 'linux' | 'web';

export interface PlatformAdapter {
  readonly id: 'web' | 'tauri';
  readonly capabilities: Capabilities;
  /** Host OS; 'web' when unknown (web panel on a router). Drives mod-key
   *  conventions (macos → Cmd, others → Ctrl), like the prototype's `S.os`. */
  readonly os: HostOS;

  /** Set the tray icon state; resolves to a placeholder on web. */
  setTrayState(state: 'off' | 'connecting' | 'on' | 'error'): Promise<TrayMenuPlaceholder>;
  /** Register a global hotkey; returns false when unsupported. */
  registerGlobalHotkey(accel: string): Promise<boolean>;
  /** Unregister a previously registered hotkey. */
  unregisterGlobalHotkey(accel: string): Promise<boolean>;
  /** Native open-file dialog; resolves canceled on web. */
  openFileDialog(filters: readonly FileFilter[]): Promise<OpenFileResult>;
  /** Native save-file dialog (returns the chosen path or null). */
  saveFileDialog(defaultName: string, filters: readonly FileFilter[]): Promise<OpenFileResult>;
  /** OS window theme, when the shell exposes it. */
  windowTheme(): WindowTheme | null;
  /** Show an OS notification. */
  showNotification(title: string, body: string): Promise<boolean>;
}

const WEB_CAPABILITIES: Capabilities = {
  tray: false,
  globalHotkeys: false,
  fileDialogs: false,
  windowControls: false,
  autostart: false,
  notifications: false,
};

function canceled(): OpenFileResult {
  return { path: null, canceled: true };
}

/** Best-effort UA detection for the web stub; the Tauri adapter overrides. */
export function detectOS(win: Window): HostOS {
  const ua = win.navigator.userAgent;
  if (ua.includes('Mac')) return 'macos';
  if (ua.includes('Windows')) return 'windows';
  if (ua.includes('Linux') || ua.includes('X11')) return 'linux';
  return 'web';
}

/** Default implementation: browser/web panel — everything is a stub. */
export const webAdapter: PlatformAdapter = {
  id: 'web',
  capabilities: WEB_CAPABILITIES,
  os: 'web',
  setTrayState(): Promise<TrayMenuPlaceholder> {
    return Promise.resolve({ kind: 'placeholder' });
  },
  registerGlobalHotkey(): Promise<boolean> {
    return Promise.resolve(false);
  },
  unregisterGlobalHotkey(): Promise<boolean> {
    return Promise.resolve(false);
  },
  openFileDialog(): Promise<OpenFileResult> {
    return Promise.resolve(canceled());
  },
  saveFileDialog(): Promise<OpenFileResult> {
    return Promise.resolve(canceled());
  },
  windowTheme(): WindowTheme | null {
    return null;
  },
  showNotification(): Promise<boolean> {
    return Promise.resolve(false);
  },
};

/**
 * Pick the adapter for the current host. The Tauri branch is the
 * documented extension point — it returns the web adapter until
 * `src/platform/tauri.ts` exists.
 */
export function getPlatformAdapter(win: Window): PlatformAdapter {
  if ('__TAURI_INTERNALS__' in win) {
    // Future: return tauriAdapter (src/platform/tauri.ts, Tauri IPC) with
    // the OS reported by the shell.
  }
  // Web stub: best-effort UA detection, so a mac-browser user keeps the
  // Cmd convention for section shortcuts.
  return { ...webAdapter, os: detectOS(win) };
}
