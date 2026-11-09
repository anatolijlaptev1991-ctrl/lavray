# LAVRay

[Русский](README.md) · [English](README.en.md) · [中文](README.zh.md) · [Español](README.es.md) · **Deutsch**

*Dies ist eine Übersetzung der russischen README. Die Dokumentation in `docs/` ist überwiegend auf Russisch.*

[![CI](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml/badge.svg)](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml)
[![Go](https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white)](core/)
[![Rust](https://img.shields.io/badge/Rust-Tauri%202-DEA584?logo=rust&logoColor=white)](shell/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](ui/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

**LAVRay** — Nachfolger von NekoBox/NekoRay: ruhige, professionelle Kontrolle über Verbindungen.
Ziel — Windows · Linux · macOS · OpenWrt; derzeit wird nur der Build für Windows veröffentlicht.

Architektur: **Go-Core** (Fork der Neko-Schicht über sing-box 1.14) + **Rust/Tauri-2-Shell** +
**einheitliche React-UI**: App-Fenster auf Desktops (funktioniert) und Webpanel auf dem Router
(der Core liefert es aus und nimmt die Anmeldung per Passwort entgegen; OpenWrt-Pakete liegen außerhalb dieses Repositorys).

> **Status: Version 0.9.3, nur für Windows veröffentlicht.** Alles aus der Tabelle unten ist im Release enthalten. Was noch nicht fertig ist oder nur mit Einschränkungen funktioniert, steht im Abschnitt „In Entwicklung“.

---

## Funktionen

| Bereich | Funktionen |
|---|---|
| **Verbindung** | Systemproxy (auch für VPN-Verbindungen unter Windows) oder TUN, Status, aktiver Server, öffentliche IP über den Tunnel. Kill switch: im TUN-Modus striktes Routing; im Proxy-Modus bleibt der Proxy je nach Einstellung bei einem Core-Absturz erhalten. TUN startet nur als Administrator (einen separaten Dienst gibt es nicht) |
| **Server** | Import von Links (vmess/vless/ss/trojan/hysteria2/tuic/nekoray), Dateien, Abos und QR-Codes (Datei, Zwischenablage, Bildschirmfoto) mit zweistufiger Bestätigung; Anzeige von QR-Codes und Export von Links; TCP-Ping, URL-Test und vollständiger Test; Suche, Klonen, Verschieben zwischen Gruppen, Entfernen unerreichbarer und doppelter Server, Auflösung von Domains in IPs; eigenes Outbound- bzw. Config-JSON wird erst nach Bestätigung per Diff angewendet |
| **Abos** | Erstellen und Aktualisieren (einzeln oder alle auf einmal), Zurücksetzen einer Abo-Aktualisierung, Laufzeit und Datenverkehr, Schutz vor Aktualisierungen, die mehr als die Hälfte der Server entfernen |
| **Routing** | 5 integrierte Presets (**LAV Preset RU** mit fest über den Proxy geleiteten Riot-Games-Domains, CN, Global, Alles durch den Proxy, Alles direkt) sowie eigene Presets: Kopie eines integrierten, Bearbeitung von Listen und Prozessregeln, Export und Import, Import von NekoRay-Routen, Regel aus einer Verbindung. Die Auswahl wird beim (Wieder-)Verbinden angewendet |
| **DNS** | einfacher Modus (DoH/DoT/lokal/eigene Server), erweitertes JSON, Split-DNS je Preset, FakeIP für TUN |
| **Verbindungen und Datenverkehr** | Geschwindigkeit in der Statusleiste, aktive und geschlossene Verbindungen mit Bytes und Regel, Schließen von Verbindungen, Erfassung des Datenverkehrs nach Profilen und Sitzungen |
| **Import aus NekoBox** | Suche nach dem NekoBox-Verzeichnis, Vorschau, Übernahme von Gruppen, Servern, Ketten, Routen und einem Teil der Einstellungen; erneute Übernahme ohne Duplikate |
| **Sicherung** | Datei `.lavbk` mit allen Daten, einschließlich Abos und Geheimnissen, verschlüsselt mit Passwort (Argon2id + XChaCha20-Poly1305); die Wiederherstellung ersetzt die Daten vollständig |
| **Integration ins System** | Autostart (bei der installierten Version als Aufgabe der Aufgabenplanung mit Administratorrechten, damit TUN direkt nach der Anmeldung startet; die Umstellung erfolgt beim Start als Administrator automatisch), automatische Verbindung zum zuletzt erfolgreich genutzten Server beim Start, Schließen in den Tray, Start minimiert, globales Tastenkürzel, Benachrichtigungen, Systemdialoge zum Öffnen und Speichern, Merken von Fenstergröße und -position |
| **Updates** | Update-Center: signierte Metadaten und minisign-Signatur der Dateien, Download mit Wiederaufnahme, Installation mit einer einzigen UAC-Abfrage, Rollback. In den Releases 0.9.x noch nicht eingerichtet (siehe „In Entwicklung“) |
| **Diagnose** | Selbsttests, Prüfung der Route einer Adresse, Core-Protokoll mit maskierten Geheimnissen, Export der sing-box-Konfiguration (mit Warnung vor Geheimnissen) |
| **KI-Agenten** | MCP-Server `lavray-core mcp` mit den Modi „Nur lesen“ und „Lesen und steuern“: [`docs/MCP.md`](docs/MCP.md) |
| **Plattformen** | Windows: NSIS-Installer und portables Archiv. Linux: die Shell wird im CI kompiliert und getestet, Pakete wurden nicht gebaut. macOS: der Core wird cross-kompiliert, die Shell wurde nicht gebaut. OpenWrt: der Core `lavray-core-linux-{amd64,arm64}` mit eingebautem Webpanel (`--web-bind`) und TProxy-Gateway (`--platform openwrt`) wird im Release veröffentlicht; Pakete (procd, LuCI, ipk/apk) gibt es noch nicht |

## In Entwicklung

Das gibt es noch nicht oder es funktioniert nur mit Einschränkungen:

- Updates sind nicht eingerichtet: das Update-Center ist fertig, aber in den Releases fehlt ein Vertrauensanker. Ihn legt der Eigentümer mit einer Schlüsselzeremonie fest ([`docs/UPDATE-SYSTEM.md`](docs/UPDATE-SYSTEM.md) §12.4); bis dahin zeigt der Bildschirm „Updates“ die Meldung „Updates sind nicht eingerichtet“ an, und neue Versionen werden manuell installiert;
- Dienst für den TUN-Modus (derzeit: Start als Administrator); vollständige Blockierung des Datenverkehrs bei einem Core-Absturz
  (WFP) — Untersuchung;
- Transport XHTTP: Links werden mit Kennzeichnung importiert, aber der Core unterstützt diesen Transport nicht;
- Links `lavray://` (Deep Link);
- Linux-Pakete (.deb, AppImage) und Build für macOS;
- OpenWrt-Pakete (procd, LuCI, ipk/apk): ihre Spezifikation steht in [`docs/OPENWRT-PACKAGING.md`](docs/OPENWRT-PACKAGING.md), der Build liegt außerhalb dieses Repositorys;
- Codesignatur: der Installer ist nicht signiert, Windows zeigt SmartScreen an.

---

## Repository-Übersicht

| Repository | Zweck |
|---|---|
| **lavray** (dieses) | gemeinsame Codebasis: Core, Shell, UI, Verträge, Design-System, Presets, Dokumentation |
| [lavray-windows](https://github.com/anatolijlaptev1991-ctrl/lavray-windows) | Windows: Releases (NSIS-Installer und ZIP), Installationsanleitung |
| lavray-linux | Linux: .deb + AppImage (geschlossen, in Entwicklung, keine Releases) |
| lavray-macos | macOS: .dmg (geschlossen, in Entwicklung, keine Releases; ohne Signatur und Notarisierung) |
| lavray-openwrt | OpenWrt: procd-Dienst, .ipk/.apk, Webpanel, luci-app (geschlossen, in Entwicklung, keine Releases) |

---

## Struktur

```
proto/       Vertrag UI ↔ Core (ConnectRPC): 13 Dienste (Anzahl der RPCs und Nachrichten — scripts/repo-stats.py)
core/        Go-Core (CGO-frei):
  internal/model        Profile/Gruppen/Einstellungen (Bean-Hierarchie von NekoBox)
  internal/store        SQLite WAL, Rechte 0700/0600; Importer für das NekoBox-Verzeichnis (store/nekoimport)
  internal/links        Link-Parser für alle Schemata (Fuzz-Tests FuzzParseLink, FuzzParseContent)
  internal/subs         Abos, Import aus anderen Clients, SSRF-Schutz
  internal/presets      5 integrierte Presets + NekoRay-Konverter + golden RU
  internal/cfgbuild     sing-box-Konfiguration: Golden-Tests, Abgleich mit dem echten Core (Tag singbox_check im CI)
  internal/inst         Manager der sing-box-Instanz (FSM: Idle/Starting/Ready/Stopping/Crashed)
  internal/api          ConnectRPC-Dienste + Recover-Interceptor (WebSessionService — nur mit `--web-bind`)
  internal/traffic      Verkehrserfassung und Verbindungsgeschwindigkeit
  internal/backup       verschlüsselte Sicherung (Format LAVBK1)
  internal/textdiff     Diff zur Bestätigung des eigenen JSON
  internal/web          Webpanel: Anmeldung (Argon2id), Sitzungen, CSRF/Origin, Limiter, TLS, Auslieferung von ui/dist (Flag `--web-bind`)
  internal/logs         Log-Multiplexer + Maskierung von Geheimnissen
  internal/updates      Update-Client TUF-lite + minisign: Prüfung, Download, Staging
  internal/gateway      OpenWrt-Gateway: nftables-Rendering, per-MAC, Watchdog (aktiviert mit `--platform openwrt`)
  internal/headless     Dienstmodus ohne UI (--headless): Autostart des letzten Profils, automatischer Neustart
  internal/mcp          MCP-Server für KI-Agenten (lavray-core mcp, über stdio): docs/MCP.md
  cmd/lavray-core       Core-Prozess: Spawn-Protokoll der Shell (§3), einmalige automatische Verbindung (`serve --connect-last`)
shell/       Rust/Tauri 2: Lebenszyklus des Cores, Systemproxy, Tray, Autostart, globale Tastenkürzel,
             Benachrichtigungen, Dialoge, Installation von Updates und Rollback
ui/          React + TS: 10 Bildschirme, 5 Sprachen (ru/en/zh/es/de), Tokens DS v1.2
presets/     integrierte Presets (lav-ru/lav-cn/global/all-proxy/all-direct)
design/      Prototyp v1.2 + Abnahmeskripte + Screenshots
docs/        Anforderungen (FR-UI-001…281), Audit, Fehler, DS, Updates, Sicherheit
scripts/     Hilfsskripte: Dokumentenprüfungen, SPDX-Header, Fakten zum Repository
```

---

## Build

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File shell\build.ps1
```

Das Skript führt aus: `npm ci && npm run build` (UI) → `go build` (Core, CGO-frei) →
`cargo tauri build --bundles nsis`. Ergebnis:
`shell\target\release\bundle\nsis\LAVRay_<ver>_x64-setup.exe`.

Anforderungen: Go 1.27+, Node 24 (wie im CI), Rust stable (geprüft mit 1.96), WebView2 (unter Windows 10/11 standardmäßig vorhanden).

### Linux

```bash
./shell/build.sh     # .deb + AppImage
```

Das Skript existiert, aber Pakete unter Linux wurden nicht gebaut und nicht geprüft: Das CI kompiliert und testet nur die Shell (ubuntu-24.04).

### macOS

```bash
./shell/build.sh     # .app + .dmg (universal: --target universal-apple-darwin)
```

Wurde weder im CI noch manuell gebaut; der Core wird für darwin/arm64 cross-kompiliert.

> Builds von v1 sind **nicht signiert** (Entscheidung des Eigentümers): Windows zeigt SmartScreen an,
> macOS — Gatekeeper. Die Installationsanleitung für Windows steht im README von
> [lavray-windows](https://github.com/anatolijlaptev1991-ctrl/lavray-windows).
> Die Integrität der Artefakte wird anhand von `SHA256SUMS.txt` aus dem Release geprüft. Signierte Metadaten und
> minisign-Signaturen erscheinen nach der Schlüsselzeremonie: Die Signatur im CI ist vorbereitet, Schlüssel gibt es noch nicht
> (`docs/UPDATE-SYSTEM.md`, „Implementierungsstatus“).

### Entwicklung

```bash
cd ui && npm run dev            # UI im Browser (der Core muss separat gestartet werden)
cd ui && npx vitest run         # UI-Tests
cd core && go test ./...        # Core-Tests
cd shell && cargo test          # Shell-Tests
python scripts/repo-stats.py    # überprüfbare Zahlen: Vertrag, Stubs, Wörterbuchschlüssel
```

---

## Sicherheit

- Updates (`internal/updates`, `shell/src/update`): TUF-lite-Metadaten (ed25519-Signaturen, monotone Seriennummer, Gültigkeit des Timestamps ≤7 Tage, Schutz vor Downgrades) und minisign-Signatur jeder Datei; vor der Installation wird die Datei noch einmal geprüft. Es gibt genau einen vertrauenswürdigen Root-Schlüssel (Schwelle 1; „2 von 3“ — nächste Phase, `docs/UPDATE-SYSTEM.md` §3.1). In den Releases 0.9.x gibt es keinen Vertrauensanker, daher sind Updates nicht eingerichtet.
- Eigenes Outbound- bzw. Config-JSON wird nur nach Bestätigung per Diff angewendet; die Bestätigung ist an den Hash des Inhalts gebunden, und jede Änderung hebt sie auf.
- Die Sicherung ist mit einem Passwort verschlüsselt (Argon2id + XChaCha20-Poly1305); ein vergessenes Passwort lässt sich nicht wiederherstellen.
- Geheimnisse werden beim Eingang einer Zeile im Protokoll maskiert (`logs.Redact`).
- Abos: SSRF-Schutz (private Adressen, IP-Pinning gegen DNS-Rebinding), Größenlimit für Antworten; Custom-Felder aus Abos und Links werden verworfen.
- Webpanel (`--web-bind`): Argon2id-Passwörter, Cookie `HttpOnly; SameSite=Strict` (+`Secure` bei HTTPS), CSRF-Header und Origin-Prüfung, Begrenzung der Anmeldeversuche pro Konto, pro Adresse und insgesamt, selbstsigniertes TLS (`--web-tls`) mit stabilem Fingerabdruck. Eine Nicht-Loopback-Adresse ist nur mit `--web-allow-remote` zulässig. Über HTTP zeigt die Oberfläche „Nicht sicher“ an. Die Ersteinrichtung auf einer Nicht-Loopback-Adresse erfordert einen einmaligen Code aus der Datei `web-setup-code` im Datenverzeichnis (Rechte 0600), damit den Administrator nicht ein zufälliger Client aus dem Netz übernehmen kann.

Richtlinie und Kontakte: [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Dokumentation

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — 281 FR
- [`docs/BUGS.md`](docs/BUGS.md) — Katalog der LNB-Fehler und ihrer Behebung
- [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) — Design-System v1.2
- [`docs/UPDATE-SYSTEM.md`](docs/UPDATE-SYSTEM.md) — TUF-lite v2.0
- [`docs/MCP.md`](docs/MCP.md) — Zugriff für KI-Agenten (Claude Desktop, Claude Code, Cursor)
- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) · [`docs/TEST-PLAN.md`](docs/TEST-PLAN.md)
- [`docs/FIX-REPORT.md`](docs/FIX-REPORT.md) — Abnahme des Audits
- [`docs/HISTORY-REWRITE.md`](docs/HISTORY-REWRITE.md) — Neuschreibung der Historie und Hashes der Releases
- [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md) — Release-Checkliste
- [`docs/RELEASE-NOTES-windows-v0.9.3.md`](docs/RELEASE-NOTES-windows-v0.9.3.md) — Neuerungen in 0.9.3
- [`docs/stage3/core-port-plan.md`](docs/stage3/core-port-plan.md) — Plan W1–W8
- [`docs/rust-migration/`](docs/rust-migration/) — Plan für die Portierung des Cores nach Rust (Entwurf)

## Lizenz

[GPL-3.0](LICENSE). Abgeleitet von nekoray (GPL-3.0) und sing-box; die Version des Cores
wird unter „Über LAVRay → Lizenzen und Komponenten“ angegeben. Quelldateien sind mit der Zeile
`SPDX-License-Identifier: GPL-3.0-only` gekennzeichnet (`python scripts/add-spdx.py --check`).
