# LAVRay

[Русский](README.md) · **English** · [中文](README.zh.md) · [Español](README.es.md) · [Deutsch](README.de.md)

*This is a translation of the Russian README. The documentation in `docs/` is mostly in Russian.*

[![CI](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml/badge.svg)](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml)
[![Go](https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white)](core/)
[![Rust](https://img.shields.io/badge/Rust-Tauri%202-DEA584?logo=rust&logoColor=white)](shell/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](ui/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

**LAVRay** — the successor to NekoBox/NekoRay: calm, professional connection control.
Target platforms: Windows · Linux · macOS · OpenWrt; currently only the Windows build is released.

Architecture: **Go core** (a fork of the neko layer over sing-box 1.14) + **Rust/Tauri 2 shell** +
**a single React UI**: the application window on desktops (working) and a web panel on the router
(the core serves it and accepts password login; OpenWrt packages live outside this repository).

> **Status: version 0.9.2, released for Windows only.** Everything in the table below is included
> in the release. What is not yet done or works with caveats is in the "In development" section.

---

## Features

| Area | What's included |
|---|---|
| **Connection** | system proxy (including for Windows VPN connections) or TUN, status, active server, public IP through the tunnel. Kill switch: in TUN mode — strict routing; in proxy mode, depending on the proxy setting, the proxy is not removed when the core crashes. TUN runs only as administrator (there is no separate service) |
| **Servers** | import of links (vmess/vless/ss/trojan/hysteria2/tuic/nekoray), files, subscriptions and QR codes (file, clipboard, screenshot) with two-step confirmation; show QR and export links; TCP ping, URL test and full test; search, cloning, moving between groups, deletion of unavailable and duplicate servers, resolving domains to IPs; custom outbound/config JSON is applied only after confirmation via diff |
| **Subscriptions** | creating and updating (one at a time or all at once), rolling back a subscription update, expiry and traffic, protection against updates that would remove more than half of the servers |
| **Routing** | 5 built-in presets (**LAV Preset RU** with Riot Games domains pinned to the proxy, CN, Global, Route everything through the proxy, Route everything directly) and custom sets: a copy of a built-in preset, editing lists and process rules, export and import, importing NekoRay routes, a rule from a connection. The selection takes effect when connecting (or reconnecting) |
| **DNS** | simple mode (DoH/DoT/local/custom servers), advanced JSON, split DNS per preset, FakeIP for TUN |
| **Connections and traffic** | speed in the status bar, active and closed connections with bytes and rule, closing a connection, traffic accounting per profile and per session |
| **Migration from NekoBox** | finding the NekoBox directory, preview, migration of groups, servers, chains, routes and part of the settings; repeated migration without duplicates |
| **Backup** | a `.lavbk` file with all data, including subscriptions and secrets, encrypted with a password (Argon2id + XChaCha20-Poly1305); restoring replaces the data entirely |
| **OS integration** | autostart (for an installed copy, as a Task Scheduler task with administrator rights, so that TUN comes up right after sign-in; the app switches to this itself when launched as administrator), auto-connect to the last successful server on launch, minimize to tray on close, start minimized, a global hotkey, notifications, system open and save dialogs, remembering window size and position |
| **Updates** | update center: signed metadata and minisign signatures for files, resumable downloads, installation with a single UAC prompt, rollback. Not yet configured in the 0.9.x releases (see "In development") |
| **Diagnostics** | self-checks, address route check, core log with secret masking, sing-box config export (with a warning about secrets) |
| **AI agents** | MCP server `lavray-core mcp` with "Read only" and "Read and control" modes: [`docs/MCP.md`](docs/MCP.md) |
| **Platforms** | Windows: NSIS installer and portable archive. Linux: the shell is compiled and tested in CI; no packages have been built. macOS: the core cross-compiles; the shell has not been built. OpenWrt: the `lavray-core-linux-{amd64,arm64}` core with the built-in web panel (`--web-bind`) and TProxy gateway (`--platform openwrt`) ships in the release; packages (procd, LuCI, ipk/apk) do not exist yet |

## In development

These are not yet available or work with caveats:

- Updates are not configured: the update center is ready, but the releases have no trust root. The owner creates it in a key ceremony ([`docs/UPDATE-SYSTEM.md`](docs/UPDATE-SYSTEM.md) §12.4); until then, the "Updates" screen shows "Updates are not configured", and new versions are installed manually;
- a service for TUN mode (currently it runs as administrator); full traffic blocking when the core crashes (WFP) — under research;
- XHTTP transport: links are imported with a flag, but the core does not support this transport;
- `lavray://` links (deep links);
- Linux packages (.deb, AppImage) and a macOS build;
- OpenWrt packages (procd, LuCI, ipk/apk): their specification is in [`docs/OPENWRT-PACKAGING.md`](docs/OPENWRT-PACKAGING.md); the build lives outside this repository;
- code signing: the installer is not signed, and Windows shows SmartScreen.

---

## Repository map

| Repository | Purpose |
|---|---|
| **lavray** (this one) | shared codebase: core, shell, UI, contracts, design system, presets, documentation |
| [lavray-windows](https://github.com/anatolijlaptev1991-ctrl/lavray-windows) | Windows: releases (NSIS installer and ZIP), installation guide |
| lavray-linux | Linux: .deb + AppImage (private, in development, no releases) |
| lavray-macos | macOS: .dmg (private, in development, no releases; unsigned and not notarized) |
| lavray-openwrt | OpenWrt: procd service, .ipk/.apk, web panel, luci-app (private, in development, no releases) |

---

## Structure

```
proto/       UI ↔ core contract (ConnectRPC): 13 services (number of RPCs and messages — scripts/repo-stats.py)
core/        Go core (CGO-free):
  internal/model        profiles/groups/settings (NekoBox bean hierarchy)
  internal/store        SQLite WAL, permissions 0700/0600; NekoBox directory importer (store/nekoimport)
  internal/links        link parsers for all schemes (fuzz tests FuzzParseLink, FuzzParseContent)
  internal/subs         subscriptions, import from other clients, SSRF protection
  internal/presets      5 built-in presets + NekoRay converter + golden RU
  internal/cfgbuild     sing-box config: golden tests, verification against the real core (singbox_check tag in CI)
  internal/inst         sing-box instance manager (FSM: Idle/Starting/Ready/Stopping/Crashed)
  internal/api          ConnectRPC services + recover interceptor (WebSessionService — only with `--web-bind`)
  internal/traffic      traffic accounting and connection speed
  internal/backup       encrypted backup (LAVBK1 format)
  internal/textdiff     diff for confirming custom JSON
  internal/web          web panel: login (Argon2id), sessions, CSRF/Origin, rate limiter, TLS, serving ui/dist (`--web-bind` flag)
  internal/logs         log multiplexer + secret masking
  internal/updates      TUF-lite + minisign update client: verification, download, staging
  internal/gateway      OpenWrt gateway: nftables rendering, per-MAC, watchdog (enabled by `--platform openwrt`)
  internal/headless     service mode without UI (--headless): auto-start of the last profile, auto-restart
  internal/mcp          MCP server for AI agents (lavray-core mcp, over stdio): docs/MCP.md
  cmd/lavray-core       core process: shell spawn protocol (§3), one-time auto-connect (`serve --connect-last`)
shell/       Rust/Tauri 2: core lifecycle, system proxy, tray, autostart, global hotkeys,
             notifications, dialogs, update installation and rollback
ui/          React + TS: 10 screens, 5 languages (ru/en/zh/es/de), DS v1.2 tokens
presets/     built-in presets (lav-ru/lav-cn/global/all-proxy/all-direct)
design/      v1.2 prototype + acceptance scripts + screenshots
docs/        requirements (FR-UI-001…281), audit, bugs, DS, updates, security
scripts/     helper scripts: document checks, SPDX headers, repository facts
```

---

## Build

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File shell\build.ps1
```

The script does the following: `npm ci && npm run build` (UI) → `go build` (core, CGO-free) →
`cargo tauri build --bundles nsis`. Result:
`shell\target\release\bundle\nsis\LAVRay_<ver>_x64-setup.exe`.

Requirements: Go 1.27+, Node 24 (as in CI), Rust stable (tested on 1.96), WebView2 (included in Windows 10/11).

### Linux

```bash
./shell/build.sh     # .deb + AppImage
```

The script is there, but Linux packages have not been built or verified: CI only compiles and tests the shell (ubuntu-24.04).

### macOS

```bash
./shell/build.sh     # .app + .dmg (universal: --target universal-apple-darwin)
```

Not built in CI or by hand; the core cross-compiles for darwin/arm64.

> v1 builds are **unsigned** (the owner's decision): Windows will show SmartScreen,
> macOS will show Gatekeeper. The Windows installation instructions are in the
> [lavray-windows](https://github.com/anatolijlaptev1991-ctrl/lavray-windows) README.
> Artifact integrity is verified against `SHA256SUMS.txt` from the release. Signed metadata
> and minisign signatures will appear after the key ceremony: signing is ready in CI, but the keys do not exist yet
> (`docs/UPDATE-SYSTEM.md`, "Implementation status").

### Development

```bash
cd ui && npm run dev            # UI in the browser (the core must be started separately)
cd ui && npx vitest run         # UI tests
cd core && go test ./...        # core tests
cd shell && cargo test          # shell tests
python scripts/repo-stats.py    # verifiable numbers: contract, stubs, dictionary keys
```

---

## Security

- Updates (`internal/updates`, `shell/src/update`): TUF-lite metadata (ed25519 signatures, monotonic serial, timestamp age ≤7 days, downgrade protection) and a minisign signature for each file; the file is verified again before installation. There is one trusted root key (threshold 1; "2-of-3" is the next phase, `docs/UPDATE-SYSTEM.md` §3.1). The 0.9.x releases have no trust root, so updates are not configured.
- Custom outbound/config JSON is applied only after confirmation via diff; the confirmation is bound to a content hash, and any edit clears it.
- The backup is encrypted with a password (Argon2id + XChaCha20-Poly1305); a forgotten password cannot be recovered.
- Secrets are masked in the log when a line is received (`logs.Redact`).
- Subscriptions: SSRF protection (private addresses, IP pinning against DNS rebinding), a response size limit, and custom fields from subscriptions and links are discarded.
- Web panel (`--web-bind`): Argon2id passwords, cookie `HttpOnly; SameSite=Strict` (+`Secure` over HTTPS), CSRF header and Origin check, a rate limiter per account, per address and a shared one, self-signed TLS (`--web-tls`) with a stable fingerprint. A non-loopback address is allowed only with `--web-allow-remote`. Over HTTP the interface shows "Not secure". Initial setup on a non-loopback address requires a one-time code from the `web-setup-code` file in the data directory (permissions 0600), so a random client on the network cannot claim the administrator role.

Policy and contacts: [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Documentation

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — 281 FR
- [`docs/BUGS.md`](docs/BUGS.md) — catalog of LNB bugs and their resolution
- [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) — design system v1.2
- [`docs/UPDATE-SYSTEM.md`](docs/UPDATE-SYSTEM.md) — TUF-lite v2.0
- [`docs/MCP.md`](docs/MCP.md) — AI agent access (Claude Desktop, Claude Code, Cursor)
- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) · [`docs/TEST-PLAN.md`](docs/TEST-PLAN.md)
- [`docs/FIX-REPORT.md`](docs/FIX-REPORT.md) — audit acceptance
- [`docs/HISTORY-REWRITE.md`](docs/HISTORY-REWRITE.md) — history rewrite and release hashes
- [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md) — release checklist
- [`docs/RELEASE-NOTES-windows-v0.9.2.md`](docs/RELEASE-NOTES-windows-v0.9.2.md) — what's new in 0.9.2
- [`docs/stage3/core-port-plan.md`](docs/stage3/core-port-plan.md) — plan W1–W8
- [`docs/rust-migration/`](docs/rust-migration/) — plan for porting the core to Rust (draft)

## License

[GPL-3.0](LICENSE). Derived from nekoray (GPL-3.0) and sing-box; the core version is listed under "About → Licenses and components". Source files are marked with the line
`SPDX-License-Identifier: GPL-3.0-only` (`python scripts/add-spdx.py --check`).
