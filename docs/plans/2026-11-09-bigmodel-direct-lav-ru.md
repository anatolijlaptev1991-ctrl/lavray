# LAV Preset RU: BigModel, DeepSeek, and Kimi Direct Implementation Plan

> **For the executing agent:** REQUIRED SUB-SKILL: use `executing-plans` to implement this plan task-by-task. This document is a specification, not permission to change settings, commit, push, install, or publish a release.

**Goal:** make BigModel, DeepSeek, and Kimi/Moonshot domains reachable from LAV Preset RU by routing them directly instead of through a proxy, while leaving Z.AI/ZCode Start Plan and all unrelated routes unchanged.

**Architecture:** move five existing entries — `domain:bigmodel.cn`, `domain:deepseek.com`, `domain:kimi.com`, `domain:moonshot.cn`, and `domain:moonshot.ai` — from `proxy_domain` to `direct_domain` in both the NekoRay source and the canonical LAVRay preset, and add `domain:kimi.ai` so the actual Kimi Code API is covered. Removing the existing entries from the proxy list is mandatory because explicit proxy rules have priority over direct rules. The same move intentionally switches these services' DNS from remote DoH through the tunnel to the local/direct DNS path. Synchronize the embedded preset, raise its data revision from 2 to 3, and regenerate the existing G28 golden configuration.

**Tech Stack:** JSON presets, Go tests, sing-box 1.14 configuration, ConnectRPC route tester, Windows/PowerShell, curl.

---

## 1. Confirmed problem and expected result

### 1.1 Evidence

Diagnostics on 2026-11-09 established:

- active preset: `lav-ru`, TUN mode, mixed/system proxy `127.0.0.1:2080`;
- `domain:bigmodel.cn`, `domain:deepseek.com`, `domain:kimi.com`, `domain:moonshot.cn`, and `domain:moonshot.ai` are currently in `proxy_domain`;
- `domain:kimi.ai` is currently absent and therefore falls through to `def_outbound: proxy`, including the actual Kimi Code API endpoint `api.kimi.ai`;
- the owner explicitly requires DeepSeek and Kimi/Moonshot to use direct routes as well; their live availability is an acceptance criterion in section 6, not a claim established by the BigModel diagnostics;
- through the selected German exit, `bigmodel.cn` accepts TCP but never returns a TLS ServerHello and times out;
- the same URL returns HTTP 200 when accessed through the physical network adapter directly;
- `open.bigmodel.cn` and `open.bigmodel.cn/api/anthropic` are reachable both directly and through the current proxy;
- the site itself is alive from an external fetch service;
- ZCode uses `https://bigmodel.cn` for BigModel management pages and `https://open.bigmodel.cn/api/anthropic` for Individual/Team Plan API traffic;
- BigModel Start Plan uses `https://zcode.z.ai`, which is a different domain and must remain behind proxy.

### 1.2 Required routing after the fix

| Address | Required route | Required DNS path |
|---|---|---|
| `bigmodel.cn` | direct (`outbound: "bypass"` in generated sing-box config) | `dns-direct` |
| `www.bigmodel.cn` | direct | `dns-direct` |
| `zcode.bigmodel.cn` | direct | `dns-direct` |
| `open.bigmodel.cn` | direct | `dns-direct` |
| `deepseek.com` | direct (`outbound: "bypass"` in generated sing-box config) | `dns-direct` |
| `chat.deepseek.com` | direct | `dns-direct` |
| `api.deepseek.com` | direct | `dns-direct` |
| `kimi.com` and its subdomains | direct | `dns-direct` |
| `kimi.ai`, including `api.kimi.ai` | direct | `dns-direct` |
| `moonshot.cn` and its subdomains | direct | `dns-direct` |
| `moonshot.ai` and its subdomains | direct | `dns-direct` |
| `z.ai`, `zcode.z.ai` | proxy, unchanged | `dns-remote`, unchanged |
| `google.ru` | proxy, unchanged | `dns-remote`, unchanged |
| RU/game domains currently in `direct_domain` | direct, unchanged | `dns-direct`, unchanged |
| all other traffic | `def_outbound: proxy`, unchanged | existing behavior, unchanged |

`domain:bigmodel.cn`, `domain:deepseek.com`, `domain:kimi.com`, `domain:kimi.ai`, `domain:moonshot.cn`, and `domain:moonshot.ai` are suffix rules and therefore cover the root domains and all their subdomains. Do not add separate duplicate entries for `www`, `open`, or `zcode.bigmodel.cn`, for `chat` or `api.deepseek.com`, or for `api.kimi.ai`.

### 1.3 Explicit non-goals

Do not:

- change ZCode binaries, account credentials, API keys, or provider definitions;
- switch the active LAVRay server as part of the permanent preset fix;
- change `def_outbound`, global DNS settings, geo databases, or other presets;
- add BigModel, DeepSeek, or Kimi/Moonshot rules to `custom_rules`;
- remove only the proxy entries and assume the default will become direct — the default is proxy;
- add these services to `direct_domain` while leaving any of their existing entries in `proxy_domain` — proxy wins;
- route only `kimi.com` directly while forgetting `kimi.ai`, `moonshot.cn`, or `moonshot.ai`;
- silently rewrite user-created preset copies;
- commit, push, sign, publish, or install anything without a separate owner instruction.

---

## 2. Immediate local workaround — separate approval required

This is a short-term workaround on one installation, not the repository fix.

1. In LAVRay open **Правила → Маршрутизация → LAV Preset RU → Настроить копию**.
2. Name it `LAV Preset RU — BigModel + DeepSeek + Kimi direct`.
3. In the copy, delete `domain:bigmodel.cn`, `domain:deepseek.com`, `domain:kimi.com`, `domain:moonshot.cn`, and `domain:moonshot.ai` from **Прокси → Домены**.
4. Add exactly one of each of these entries to **Напрямую → Домены**: `domain:bigmodel.cn`, `domain:deepseek.com`, `domain:kimi.com`, `domain:kimi.ai`, `domain:moonshot.cn`, `domain:moonshot.ai`.
5. Keep **Для остального трафика → Прокси** unchanged.
6. Save and activate the copy; restart/reconnect the running profile when prompted.
7. Run the acceptance checks in section 6.
8. After receiving built-in revision 3, return to the built-in preset or reset this copy to its source. Do not leave an unnecessary customized copy active: updater revisions do not silently replace user copies.

**Local rollback:** reactivate the previous built-in `LAV Preset RU` and reconnect. Do not delete the custom copy unless the owner asks.

---

## 3. Permanent repository fix

### Task 1: Add failing route-regression tests first

**Files:**
- Modify: `core/internal/api/route_check_test.go:28-41`
- Modify: `core/internal/api/route_check_test.go:76-97`

**Step 1: Extend `TestCheckRouteMatchesRealConfig`**

Add these cases to the existing table:

```go
{"lav-ru", "bigmodel.cn", direct, false},
{"lav-ru", "www.bigmodel.cn", direct, false},
{"lav-ru", "zcode.bigmodel.cn", direct, false},
{"lav-ru", "https://open.bigmodel.cn/api/anthropic", direct, false},
{"lav-ru", "deepseek.com", direct, false},
{"lav-ru", "chat.deepseek.com", direct, false},
{"lav-ru", "https://api.deepseek.com/v1/models", direct, false},
{"lav-ru", "kimi.com", direct, false},
{"lav-ru", "https://api.kimi.ai/coding/v1", direct, false},
{"lav-ru", "api.moonshot.cn", direct, false},
{"lav-ru", "api.moonshot.ai", direct, false},
{"lav-ru", "zcode.z.ai", proxy, false},
```

The first eleven cases are the BigModel/DeepSeek/Kimi regression. The last one prevents an accidental global change of Z.AI/Start Plan routing.

**Step 2: Extend `TestCheckRouteExplainsTheMatch`**

Add:

```go
if r := check("bigmodel.cn"); r.GetMatchedList() != "direct_domain" || !strings.Contains(r.GetMatchedRule(), "domain_suffix") {
	t.Errorf("bigmodel.cn: list=%q rule=%q", r.GetMatchedList(), r.GetMatchedRule())
}
if r := check("deepseek.com"); r.GetMatchedList() != "direct_domain" || !strings.Contains(r.GetMatchedRule(), "domain_suffix") {
	t.Errorf("deepseek.com: list=%q rule=%q", r.GetMatchedList(), r.GetMatchedRule())
}
if r := check("api.kimi.ai"); r.GetMatchedList() != "direct_domain" || !strings.Contains(r.GetMatchedRule(), "domain_suffix") {
	t.Errorf("api.kimi.ai: list=%q rule=%q", r.GetMatchedList(), r.GetMatchedRule())
}
```

**Step 3: Prove the regression test fails before the preset fix**

Run from `core/`:

```bash
go test ./internal/api -run 'TestCheckRouteMatchesRealConfig|TestCheckRouteExplainsTheMatch' -count=1
```

Expected before the fix: FAIL; BigModel, DeepSeek, and Kimi/Moonshot cases produce `OUTBOUND_PROXY` instead of `OUTBOUND_DIRECT`. Do not edit the expected values to match the broken behavior.

---

### Task 2: Move BigModel, DeepSeek, and Kimi/Moonshot in the NekoRay source and canonical preset

**Files:**
- Modify: `presets/lav-ru.source.json:5,9`
- Modify: `presets/lav-ru.json:4,14-21,64-75,123-132`

**Step 1: Edit the source of the NekoRay conversion vector**

In `presets/lav-ru.source.json`:

- remove the single lines `domain:kimi.com`, `domain:moonshot.cn`, `domain:moonshot.ai`, `domain:deepseek.com`, and `domain:bigmodel.cn` from the newline-delimited `proxy_domain` string;
- append `domain:bigmodel.cn`, `domain:deepseek.com`, `domain:kimi.com`, `domain:kimi.ai`, `domain:moonshot.cn`, and `domain:moonshot.ai`, one line each, to the newline-delimited `direct_domain` string.

Conceptually, the affected source values must become:

```text
proxy_domain:  …\ndomain:codeiumdata.com\ndomain:mistral.ai…\ndomain:z.ai\ndomain:qwen.ai…
direct_domain: …\ndomain:platipomiru.com\ndomain:bigmodel.cn\ndomain:deepseek.com\ndomain:kimi.com\ndomain:kimi.ai\ndomain:moonshot.cn\ndomain:moonshot.ai
```

There must be zero BigModel/DeepSeek/Kimi/Moonshot entries in `proxy_domain` and exactly one of each required entry in `direct_domain`. `domain:kimi.ai` is a new direct entry; the other five are moves.

**Step 2: Apply the same routing move to the canonical preset**

In `presets/lav-ru.json`:

- remove `"domain:kimi.com",`, `"domain:moonshot.cn",`, `"domain:moonshot.ai",`, `"domain:deepseek.com",`, and `"domain:bigmodel.cn",` from `routing.proxy_domain`;
- add `"domain:bigmodel.cn"`, `"domain:deepseek.com"`, `"domain:kimi.com"`, `"domain:kimi.ai"`, `"domain:moonshot.cn"`, and `"domain:moonshot.ai"` as the final items of `routing.direct_domain`, with valid JSON commas;
- keep `routing.def_outbound` equal to `"proxy"`;
- keep `routing.custom_rules` unchanged.

The resulting direct-list tail is:

```json
"direct_domain": [
  "geosite:category-ru",
  "geosite:category-gov-ru",
  "geosite:riot",
  "geosite:steam",
  "domain:exitgames.com",
  "domain:photonengine.io",
  "domain:photonengine.com",
  "domain:platipomiru.com",
  "domain:bigmodel.cn",
  "domain:deepseek.com",
  "domain:kimi.com",
  "domain:kimi.ai",
  "domain:moonshot.cn",
  "domain:moonshot.ai"
]
```

**Step 3: Raise the data revision**

Change:

```json
"revision": 2
```

to:

```json
"revision": 3
```

Do not change `version`, `id`, or `builtin`.

**Step 4: Make the UI description truthful in all five languages**

Set `description` to:

```json
{
  "ru": "Русские сайты (geosite category-ru/gov-ru), игровые домены/приложения, BigModel, DeepSeek и Kimi/Moonshot — напрямую; остальные AI- и dev-сервисы и прочий трафик — через прокси; реклама блокируется. Раздельный DNS: RU, игры, BigModel, DeepSeek и Kimi/Moonshot — DNS провайдера, остальное — DoH через туннель.",
  "zh": "俄罗斯网站（category-ru/gov-ru）、游戏域名/程序、BigModel、DeepSeek 和 Kimi/Moonshot 直连；其他 AI 与开发服务及其余流量走代理；广告拦截。DNS 分流：俄罗斯网站、游戏、BigModel、DeepSeek 和 Kimi/Moonshot 走运营商 DNS，其余经隧道 DoH。",
  "en": "Russian sites (geosite category-ru/gov-ru), game domains/apps, BigModel, DeepSeek, and Kimi/Moonshot go direct; other AI/dev services and all other traffic go through the proxy; ads are blocked. Split DNS: RU, games, BigModel, DeepSeek, and Kimi/Moonshot via ISP DNS; everything else via DoH through the tunnel.",
  "es": "Los sitios rusos (geosite category-ru/gov-ru), los dominios/programas de juegos, BigModel, DeepSeek y Kimi/Moonshot van directos; los demás servicios de IA/desarrollo y el resto del tráfico van por proxy; los anuncios se bloquean. DNS dividido: RU, juegos, BigModel, DeepSeek y Kimi/Moonshot usan el DNS del proveedor; el resto usa DoH a través del túnel.",
  "de": "Russische Webseiten (geosite category-ru/gov-ru), Spiele-Domains/-Apps, BigModel, DeepSeek und Kimi/Moonshot laufen direkt; andere KI-/Dev-Dienste und der übrige Datenverkehr laufen über den Proxy; Werbung wird blockiert. Getrenntes DNS: RU, Spiele, BigModel, DeepSeek und Kimi/Moonshot über den Provider-DNS, der Rest über DoH durch den Tunnel."
}
```

Append this sentence to `maintainer_notes` without deleting the existing notes:

```text
Rev 3: domain:bigmodel.cn, domain:deepseek.com, domain:kimi.com, domain:moonshot.cn и domain:moonshot.ai перенесены из proxy_domain в direct_domain; domain:kimi.ai добавлен в direct_domain для api.kimi.ai; DNS этих сервисов переключён с dns-remote на dns-direct; z.ai и ZCode Start Plan не изменены.
```

**Step 5: Synchronize the embedded copy byte-for-byte**

From the repository root:

```bash
cp presets/lav-ru.json core/internal/presets/builtin/lav-ru.json
```

Expected: `presets/lav-ru.json` and `core/internal/presets/builtin/lav-ru.json` are byte-identical.

---

### Task 3: Verify conversion and built-in synchronization

**Files:**
- Verify: `presets/lav-ru.source.json`
- Verify: `presets/lav-ru.json`
- Verify: `core/internal/presets/builtin/lav-ru.json`
- Test: `core/internal/presets/preset_test.go`

Run from `core/`:

```bash
gofmt -w internal/api/route_check_test.go
go test ./internal/presets -run 'TestBuiltinPresetsLoad|TestBuiltinInSyncWithRepo|TestGoldenLavRU' -count=1
```

Expected: PASS.

This proves:

- the source-to-canonical conversion remains deterministic;
- no unrelated routing/DNS fields changed;
- the embedded copy is synchronized;
- the new preset passes schema validation.

---

### Task 4: Regenerate and inspect G28

**Files:**
- Regenerate: `core/internal/cfgbuild/testdata/golden/G28.want.json`
- Do not manually edit any other `G*.want.json`

Only `G28.in.json` references `"preset": "lav-ru"`; therefore only G28 should change inside the golden directory.

Run from `core/`:

```bash
go test ./internal/cfgbuild -run TestGolden -update
go test ./internal/cfgbuild -run 'TestGolden|TestRouteTableIsTheConfigRules' -count=1
```

Expected: PASS.

Inspect the diff:

```bash
git diff --name-only -- core/internal/cfgbuild/testdata/golden
git diff -- core/internal/cfgbuild/testdata/golden/G28.want.json
```

Required diff properties:

1. `bigmodel.cn`, `deepseek.com`, `kimi.com`, `kimi.ai`, `moonshot.cn`, and `moonshot.ai` are absent from the DNS rule whose server is `dns-remote`.
2. All six appear in the DNS rule whose server is `dns-direct`.
3. The five pre-existing entries disappear from the route rule with `outbound: "proxy"`; `kimi.ai` must never have been there.
4. All six appear in the direct route rule with `outbound: "bypass"`.
5. No other route, outbound, server, DNS, geo, or process rule changes.

If another `G*.want.json` changed, stop and explain why; do not accept a bulk golden rewrite blindly.

---

### Task 5: Update maintainer documentation

**Files:**
- Modify: `docs/PRESET-LAV-RU.md:8-17,31-36`
- Modify: `presets/SCHEMA.md:6,84-88`
- Modify: `presets/README.md:9,38-41`

Required documentation updates:

- add BigModel, DeepSeek, and Kimi/Moonshot to the direct-traffic row in `docs/PRESET-LAV-RU.md`;
- state that these services use direct/local DNS and that `zcode.z.ai` remains proxied;
- retain the documented proxy-before-direct priority and explain why the existing entries were moved, not duplicated, and why `kimi.ai` was added;
- change the LAV RU revision reference to 3;
- add `bigmodel.cn → direct`, `deepseek.com → direct`, `api.kimi.ai → direct`, and `zcode.z.ai → proxy` to the priority-test examples;
- change `presets/README.md` from the stale LAV RU rev 1 reference to rev 3.

Do not rewrite historical audit reports or old release notes.

---

## 4. Required automated verification

Run all commands from `core/` unless stated otherwise.

### 4.1 Focused tests

```bash
go test ./internal/presets -count=1
go test ./internal/cfgbuild -count=1
go test ./internal/api -run 'TestCheckRouteMatchesRealConfig|TestCheckRouteExplainsTheMatch' -count=1
go test ./internal/updates ./internal/api -run 'Preset|Update' -count=1
```

Expected: all PASS.

### 4.2 Full ordinary core suite

```bash
go test ./... -timeout 120s
```

Expected: all PASS, matching CI.

### 4.3 Real sing-box validation of every golden

Run locally only if the pinned fork and dependencies are already available; otherwise this is a mandatory CI gate, not an optional skipped check:

```bash
TAGS="$(tr -d '[:space:]' < BUILD_TAGS)"
go test -tags "singbox_check,$TAGS" ./internal/cfgbuild/ -run TestGoldenSingBoxCheck -count=1 -timeout 300s
```

Environment used by CI:

```bash
export CGO_ENABLED=0
export GOPRIVATE=github.com/anatolijlaptev1991-ctrl/*
export GOFLAGS=-mod=mod
```

Expected: `TestGoldenSingBoxCheck` PASS, including G28. A skipped local run must be reported as skipped until CI is green.

### 4.4 Build check

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File shell\build.ps1
```

Expected: UI, real `lavray-core.exe`, and NSIS package build successfully. Installing the package is a separate action and requires the test-PC/owner approval described in M09.

---

## 5. Updater and migration requirements

For an official revision-3 data update:

1. Publish the canonical `presets/lav-ru.json` as the updater input `release-data/presets/lav-ru.json` only when a data release is explicitly approved.
2. Manifest entry must identify `lav-ru` revision 3 and the exact SHA-256 of that file.
3. Do not publish revisions 2 and 3 under the same filename or reuse revision 2 after the content changed.
4. Existing installations using the built-in preset receive the override in `<data>/presets/override/lav-ru.json`.
5. If revision 3 changes the active preset while connected, the updater must report `ready_for_restart`/`needs_profile_restart`; reconnect before testing.
6. User-created copies remain untouched. They should show `source_updated`; only an explicit **Сбросить к исходному** may replace their rules.
7. Rollback through `Rollback(PRESETS)` must restore revision 2, followed by profile reconnect.

The normal signing and publication procedure is documented in `docs/UPDATE-SYSTEM.md` §12.10. It is outside this implementation task until separately approved.

---

## 6. Live acceptance checklist

Perform these checks only after the modified preset is active and the profile has reconnected.

### 6.1 Route tester

In **Правила → Проверить маршрут** verify:

| Input | Expected |
|---|---|
| `bigmodel.cn` | Напрямую, `direct_domain`, `domain_suffix` |
| `www.bigmodel.cn` | Напрямую |
| `zcode.bigmodel.cn` | Напрямую |
| `open.bigmodel.cn` | Напрямую |
| `deepseek.com` | Напрямую, `direct_domain`, `domain_suffix` |
| `chat.deepseek.com` | Напрямую |
| `api.deepseek.com` | Напрямую |
| `kimi.com` | Напрямую, `direct_domain`, `domain_suffix` |
| `api.kimi.ai` | Напрямую |
| `api.moonshot.cn` | Напрямую |
| `api.moonshot.ai` | Напрямую |
| `zcode.z.ai` | Прокси |
| `google.ru` | Прокси, as before |
| `lori.ru` | Напрямую, as before |
| `login.riotgames.com` | Прокси, custom pin still wins |
| `8.8.8.8` | Прокси by default |

### 6.2 Real HTTP/TLS checks

```bash
curl.exe --proxy http://127.0.0.1:2080 -I -S --max-time 20 --connect-timeout 8 https://bigmodel.cn
curl.exe --proxy http://127.0.0.1:2080 -I -S --max-time 20 --connect-timeout 8 https://www.bigmodel.cn
curl.exe --proxy http://127.0.0.1:2080 -I -S --max-time 20 --connect-timeout 8 https://open.bigmodel.cn/api/anthropic
curl.exe --proxy http://127.0.0.1:2080 -I -S --max-time 20 --connect-timeout 8 https://deepseek.com
curl.exe --proxy http://127.0.0.1:2080 -I -S --max-time 20 --connect-timeout 8 https://chat.deepseek.com
curl.exe --proxy http://127.0.0.1:2080 -I -S --max-time 20 --connect-timeout 8 https://api.deepseek.com/v1/models
curl.exe --proxy http://127.0.0.1:2080 -I -S --max-time 20 --connect-timeout 8 https://kimi.com
curl.exe --proxy http://127.0.0.1:2080 -I -S --max-time 20 --connect-timeout 8 https://api.kimi.ai/coding/v1
curl.exe --proxy http://127.0.0.1:2080 -I -S --max-time 20 --connect-timeout 8 https://api.moonshot.cn
curl.exe --proxy http://127.0.0.1:2080 -I -S --max-time 20 --connect-timeout 8 https://api.moonshot.ai
curl.exe --proxy http://127.0.0.1:2080 -I -S --max-time 20 --connect-timeout 8 https://zcode.z.ai/api/v1/zcode-plan/anthropic
```

Pass criteria:

- every BigModel, DeepSeek, and Kimi/Moonshot command returns an HTTP response without a connection/TLS timeout; HTTP 200 is expected for BigModel at the time of writing, while redirects or unauthenticated API responses such as 401/403/404 are acceptable for API endpoints;
- `zcode.z.ai` also returns an HTTP response without network timeout — the current HEAD response may legitimately be 404 because the base API path is not a document;
- no check is made by disabling the firewall, kill switch, or unrelated proxy rules.

### 6.3 ZCode account acceptance

This requires the account owner to complete login; no credentials may be copied into tests, logs, or this document.

1. Open the BigModel management page from ZCode.
2. Complete BigModel authorization.
3. Select the intended plan/model again.
4. Confirm the provider is present and usable instead of `provider-not-found`.
5. Make a minimal model request and verify a normal response.
6. Confirm old session restore no longer logs `session.model_selection.restore_unbound` for the selected provider.

Do not treat a successful website check as proof of subscription entitlement: account authorization and quota are separate gates.

---

## 7. Rollback

### Repository rollback before publication

Revert only the files in this plan, then regenerate G28 and rerun section 4. Do not use destructive repository-wide reset commands and do not touch unrelated working-tree changes.

### Installed preset rollback

- For a custom-copy workaround: activate built-in `LAV Preset RU` and reconnect.
- For an updater-delivered revision 3: use **Откатить** for PRESETS and reconnect.
- If BigModel, DeepSeek, or Kimi/Moonshot becomes unreachable directly in the future, restore revision 2 behavior for the affected domain or choose a working proxy exit; do not silently broaden direct routing to unrelated domains.

---

## 8. Definition of done

The task is complete only when all are true:

- source, canonical, and embedded LAV RU presets agree;
- revision is 3 everywhere in the active product preset;
- `domain:bigmodel.cn`, `domain:deepseek.com`, `domain:kimi.com`, `domain:kimi.ai`, `domain:moonshot.cn`, and `domain:moonshot.ai` each occur exactly once in `direct_domain` and nowhere in `proxy_domain`;
- `def_outbound` remains proxy and `zcode.z.ai` remains proxied;
- route and DNS goldens show the intended move and nothing unrelated;
- focused tests, full `go test ./...`, and real sing-box golden validation pass or the latter is explicitly awaiting a required CI run;
- live route tester and curl checks pass through LAVRay;
- the account owner has separately verified ZCode login if account restoration is part of the requested delivery;
- no user custom preset was overwritten, and no unapproved commit, release, or installation was performed.
