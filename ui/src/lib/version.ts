/**
 * Версия приложения — из `ui/package.json`, подставляется при сборке Vite.
 * T-71: раньше «Настройки» показывали литерал `v0.1.0` в двух местах.
 * Версию ядра отдаёт само ядро (`CoreStatus.coreVersion`).
 */
import { version } from '../../package.json';

export const APP_VERSION: string = version;
