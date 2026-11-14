# LAVRay

[Русский](README.md) · [English](README.en.md) · [中文](README.zh.md) · **Español** · [Deutsch](README.de.md)

*Traducción del README en ruso. La documentación de `docs/` está mayormente en ruso.*

[![CI](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml/badge.svg)](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml)
[![Go](https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white)](core/)
[![Rust](https://img.shields.io/badge/Rust-Tauri%202-DEA584?logo=rust&logoColor=white)](shell/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](ui/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

**LAVRay** — sucesor de NekoBox/NekoRay: control de la conexión sereno y profesional.
Plataformas objetivo — Windows · Linux · macOS · OpenWrt; por ahora solo se publica la compilación para Windows.

Arquitectura: **núcleo en Go** (fork de la capa neko sobre sing-box 1.14) + **shell en Rust/Tauri 2** +
**UI única en React**: ventana de la aplicación en escritorio (funciona) y panel web en el router
(el núcleo lo sirve y acepta el inicio de sesión con contraseña; los paquetes de OpenWrt están fuera de este repositorio).

> **Estado: versión 0.9.4, solo para Windows.** Todo lo de la tabla siguiente está en esta versión.
> Lo que aún no está hecho o funciona con reservas, en la sección «En desarrollo».

---

## Características

| Área | Qué incluye |
|---|---|
| **Conexión** | proxy del sistema (también para las conexiones VPN de Windows) o TUN, estado, servidor activo, IP pública a través del túnel. Kill switch: en TUN — enrutamiento estricto; en modo proxy, con la opción de proxy activada, el proxy no se quita si el núcleo falla. TUN solo se inicia como administrador (no hay servicio aparte) |
| **Servidores** | importación de enlaces (vmess/vless/ss/trojan/hysteria2/tuic/nekoray), archivos, suscripciones y código QR (archivo, portapapeles, captura de pantalla) con confirmación en dos fases; mostrar QR y exportar enlaces; ping TCP, prueba de URL y prueba completa; búsqueda, clonado, traslado entre grupos, eliminación de servidores no disponibles y duplicados, resolución de dominios a IP; el JSON propio de outbound/config se aplica solo tras confirmarlo mediante diff |
| **Suscripciones** | creación y actualización (una a una o todas a la vez), reversión de la actualización de una suscripción, caducidad y tráfico, protección frente a actualizaciones que eliminen más de la mitad de los servidores |
| **Enrutamiento** | 5 presets integrados (**LAV Preset RU** (predeterminado) con los dominios de Riot Games fijados al proxy, CN, Global, Todo por el proxy, Todo directo) y conjuntos propios: copia de uno integrado, edición de listas y reglas de procesos, exportación e importación, importación de rutas de NekoRay, regla desde una conexión. La selección se aplica al (re)conectar |
| **DNS** | modo simple (DoH/DoT/local/servidores propios), JSON avanzado, DNS dividido por preset, FakeIP para TUN |
| **Conexiones y tráfico** | velocidad en la barra de estado, conexiones activas y cerradas con bytes y regla, cierre de conexiones, contabilidad del tráfico por perfiles y sesiones |
| **Importación desde NekoBox** | búsqueda del directorio de NekoBox, vista previa, importación de grupos, servidores, cadenas, rutas y parte de los ajustes; repetir la importación no crea duplicados |
| **Copia de seguridad** | archivo `.lavbk` con todos los datos, incluidas las suscripciones y los secretos, cifrado con contraseña (Argon2id + XChaCha20-Poly1305); la restauración sustituye los datos por completo |
| **Integración con el SO** | arranque automático (en la copia instalada, mediante una tarea del Programador de tareas con permisos de administrador, para que TUN se active justo tras iniciar sesión; se convierte en tarea automáticamente al arrancar como administrador), conexión automática al último servidor que funcionó al iniciar, cierre a la bandeja, inicio minimizado, atajo de teclado global, notificaciones, diálogos del sistema para abrir y guardar, recuerdo del tamaño y la posición de la ventana |
| **Actualizaciones** | centro de actualizaciones: metadatos firmados y firma minisign de los archivos, descarga con reanudación, instalación con una sola solicitud de UAC, reversión. En las versiones 0.9.x todavía no está configurado (ver «En desarrollo») |
| **Diagnóstico** | autocomprobaciones, comprobación de la ruta de una dirección, registro del núcleo con enmascaramiento de secretos, exportación de la configuración de sing-box (con aviso sobre los secretos) |
| **Agentes de IA** | servidor MCP `lavray-core mcp` con los modos «Solo lectura» y «Lectura y control»: [`docs/MCP.md`](docs/MCP.md) |
| **Plataformas** | Windows: instalador NSIS y archivo portable. Linux: el shell se compila y prueba en CI; los paquetes no se han generado. macOS: el núcleo se compila de forma cruzada; el shell no se ha compilado. OpenWrt: el núcleo `lavray-core-linux-{amd64,arm64}` con el panel web integrado (`--web-bind`) y la puerta de enlace TProxy (`--platform openwrt`) se publica en la versión; todavía no hay paquetes (procd, LuCI, ipk/apk) |

## En desarrollo

Esto todavía no existe o funciona con reservas:

- las actualizaciones no están configuradas: el centro de actualizaciones está listo, pero las versiones no incluyen una raíz de confianza. La crea el propietario mediante una ceremonia de claves ([`docs/UPDATE-SYSTEM.md`](docs/UPDATE-SYSTEM.md) §12.4); hasta entonces, la pantalla «Actualizaciones» muestra «Las actualizaciones no están configuradas», y las nuevas versiones se instalan manualmente;
- un servicio para el modo TUN (ahora mismo, el arranque como administrador); el bloqueo total del tráfico cuando el núcleo falla (WFP) — en investigación;
- transporte XHTTP: los enlaces se importan con una marca, pero el núcleo no admite ese transporte;
- enlaces `lavray://` (deep link);
- paquetes para Linux (.deb, AppImage) y compilación para macOS;
- paquetes de OpenWrt (procd, LuCI, ipk/apk): su especificación está en [`docs/OPENWRT-PACKAGING.md`](docs/OPENWRT-PACKAGING.md); la compilación está fuera de este repositorio;
- firma de código: el instalador no está firmado y Windows muestra SmartScreen.

---

## Mapa de repositorios

| Repositorio | Finalidad |
|---|---|
| **lavray** (este) | base de código común: núcleo, shell, UI, contratos, sistema de diseño, presets, documentación |
| [lavray-windows](https://github.com/anatolijlaptev1991-ctrl/lavray-windows) | Windows: versiones (instalador NSIS y ZIP), instrucciones de instalación |
| lavray-linux | Linux: .deb + AppImage (cerrado, en desarrollo, sin versiones) |
| lavray-macos | macOS: .dmg (cerrado, en desarrollo, sin versiones; sin firma ni notarización) |
| lavray-openwrt | OpenWrt: servicio procd, .ipk/.apk, panel web, luci-app (cerrado, en desarrollo, sin versiones) |

---

## Estructura

```
proto/       contrato UI ↔ núcleo (ConnectRPC): 13 servicios (número de RPC y mensajes — scripts/repo-stats.py)
core/        núcleo en Go (sin CGO):
  internal/model        perfiles/grupos/ajustes (jerarquía de beans de NekoBox)
  internal/store        SQLite WAL, permisos 0700/0600; importador del directorio de NekoBox (store/nekoimport)
  internal/links        analizadores de enlaces de todos los esquemas (pruebas de fuzzing FuzzParseLink, FuzzParseContent)
  internal/subs         suscripciones, importación desde otros clientes, protección SSRF
  internal/presets      5 presets integrados + conversor de NekoRay + golden RU
  internal/cfgbuild     configuración de sing-box: pruebas golden, verificación con el núcleo real (etiqueta singbox_check en CI)
  internal/inst         gestor de la instancia de sing-box (FSM: Idle/Starting/Ready/Stopping/Crashed)
  internal/api          servicios ConnectRPC + interceptor recover (WebSessionService — solo con `--web-bind`)
  internal/traffic      contabilidad del tráfico y velocidad de las conexiones
  internal/backup       copia de seguridad cifrada (formato LAVBK1)
  internal/textdiff     diff para confirmar el JSON propio
  internal/web          panel web: inicio de sesión (Argon2id), sesiones, CSRF/Origin, limitador, TLS, servir ui/dist (opción `--web-bind`)
  internal/logs         multiplexor de registros + enmascaramiento de secretos
  internal/updates      cliente de actualizaciones TUF-lite + minisign: verificación, descarga, staging
  internal/gateway      puerta de enlace OpenWrt: render de nftables, per-MAC, watchdog (se activa con `--platform openwrt`)
  internal/headless     modo de servicio sin UI (--headless): arranque automático del último perfil, reinicio automático
  internal/mcp          servidor MCP para agentes de IA (lavray-core mcp, por stdio): docs/MCP.md
  cmd/lavray-core       proceso del núcleo: protocolo de arranque del shell (§3), conexión automática única (`serve --connect-last`)
shell/       Rust/Tauri 2: ciclo de vida del núcleo, proxy del sistema, bandeja, arranque automático, atajos globales,
             notificaciones, diálogos, instalación de actualizaciones y reversión
ui/          React + TS: 10 pantallas, 5 idiomas (ru/en/zh/es/de), tokens DS v1.2
presets/     presets integrados (lav-ru/lav-cn/global/all-proxy/all-direct)
design/      prototipo v1.2 + scripts de aceptación + capturas
docs/        requisitos (FR-UI-001…281), auditoría, errores, DS, actualizaciones, seguridad
scripts/     scripts auxiliares: comprobaciones de documentos, cabeceras SPDX, datos del repositorio
```

---

## Compilación

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File shell\build.ps1
```

El script hace: `npm ci && npm run build` (UI) → `go build` (núcleo, sin CGO) →
`cargo tauri build --bundles nsis`. Resultado:
`shell\target\release\bundle\nsis\LAVRay_<ver>_x64-setup.exe`.

Requisitos: Go 1.27+, Node 24 (igual que en CI), Rust stable (probado con 1.96), WebView2 (incluido de serie en Windows 10/11).

### Linux

```bash
./shell/build.sh     # .deb + AppImage
```

El script existe, pero los paquetes para Linux no se han compilado ni verificado: el CI solo compila y prueba el shell (ubuntu-24.04).

### macOS

```bash
./shell/build.sh     # .app + .dmg (universal: --target universal-apple-darwin)
```

No se ha compilado ni en CI ni a mano; el núcleo se compila de forma cruzada para darwin/arm64.

> Las compilaciones v1 **no están firmadas** (decisión del propietario): Windows mostrará SmartScreen y macOS, Gatekeeper. Las instrucciones de instalación para Windows están en el README de [lavray-windows](https://github.com/anatolijlaptev1991-ctrl/lavray-windows).
> La integridad de los artefactos se verifica con `SHA256SUMS.txt` de la versión. Los metadatos firmados y las firmas minisign aparecerán después de la ceremonia de claves: la firma en CI está lista, pero todavía no hay claves (`docs/UPDATE-SYSTEM.md`, «Estado de implementación»).

### Desarrollo

```bash
cd ui && npm run dev            # UI en el navegador (el núcleo hay que iniciarlo aparte)
cd ui && npx vitest run         # pruebas de la UI
cd core && go test ./...        # pruebas del núcleo
cd shell && cargo test          # pruebas del shell
python scripts/repo-stats.py    # cifras verificables: contrato, stubs, claves de los diccionarios
```

---

## Seguridad

- Actualizaciones (`internal/updates`, `shell/src/update`): metadatos TUF-lite (firmas ed25519, serial monótono, vigencia del timestamp ≤7 días, protección frente a downgrade) y firma minisign de cada archivo; antes de instalar, el archivo se vuelve a verificar. Hay una única clave raíz de confianza (umbral 1; «2 de 3» es la fase siguiente, `docs/UPDATE-SYSTEM.md` §3.1). En las versiones 0.9.x no hay raíz de confianza, por lo que las actualizaciones no están configuradas.
- El JSON propio de outbound/config solo se aplica tras confirmarlo mediante diff; la confirmación está vinculada al hash del contenido, y cualquier cambio la anula.
- La copia de seguridad está cifrada con contraseña (Argon2id + XChaCha20-Poly1305); una contraseña olvidada no se puede recuperar.
- Los secretos se enmascaran en el registro al recibir cada línea (`logs.Redact`).
- Suscripciones: protección SSRF (direcciones privadas, fijación de IP frente a DNS-rebinding), límite de tamaño de respuesta; los campos custom de suscripciones y enlaces se descartan.
- Panel web (`--web-bind`): contraseñas Argon2id, cookie `HttpOnly; SameSite=Strict` (+`Secure` con HTTPS), cabecera CSRF y comprobación de Origin, limitador de intentos por cuenta, por dirección y global, TLS autofirmado (`--web-tls`) con huella estable. Una dirección que no sea loopback solo con `--web-allow-remote`. Por HTTP, la interfaz muestra «No segura». La configuración inicial en una dirección que no sea loopback requiere un código de un solo uso del archivo `web-setup-code` en el directorio de datos (permisos 0600), para que un cliente de red cualquiera no pueda tomar la cuenta de administrador.

Política y contactos: [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Documentación

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — 281 FR
- [`docs/BUGS.md`](docs/BUGS.md) — catálogo de errores LNB y su cierre
- [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) — sistema de diseño v1.2
- [`docs/UPDATE-SYSTEM.md`](docs/UPDATE-SYSTEM.md) — TUF-lite v2.0
- [`docs/MCP.md`](docs/MCP.md) — acceso de agentes de IA (Claude Desktop, Claude Code, Cursor)
- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) · [`docs/TEST-PLAN.md`](docs/TEST-PLAN.md)
- [`docs/FIX-REPORT.md`](docs/FIX-REPORT.md) — aceptación de la auditoría
- [`docs/HISTORY-REWRITE.md`](docs/HISTORY-REWRITE.md) — reescritura del historial y hashes de las versiones
- [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md) — lista de verificación de la versión
- [`docs/RELEASE-NOTES-windows-v0.9.4.md`](docs/RELEASE-NOTES-windows-v0.9.4.md) — novedades de la 0.9.4
- [`docs/stage3/core-port-plan.md`](docs/stage3/core-port-plan.md) — plan W1–W8
- [`docs/rust-migration/`](docs/rust-migration/) — plan para migrar el núcleo a Rust (borrador)

## Licencia

[GPL-3.0](LICENSE). Derivado de nekoray (GPL-3.0) y sing-box; la versión del núcleo se indica en «Acerca de LAVRay → Licencias y componentes». Los archivos fuente llevan la línea `SPDX-License-Identifier: GPL-3.0-only` (`python scripts/add-spdx.py --check`).
