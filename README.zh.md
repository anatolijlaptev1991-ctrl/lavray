# LAVRay

[Русский](README.md) · [English](README.en.md) · **中文** · [Español](README.es.md) · [Deutsch](README.de.md)

*本文是俄语版 README 的译文。`docs/` 目录中的文档主要为俄语。*

[![CI](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml/badge.svg)](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml)
[![Go](https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white)](core/)
[![Rust](https://img.shields.io/badge/Rust-Tauri%202-DEA584?logo=rust&logoColor=white)](shell/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](ui/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

**LAVRay** — NekoBox/NekoRay 的继承者：平稳、专业的连接控制。
目标平台：Windows · Linux · macOS · OpenWrt；当前仅发布 Windows 版本。

架构：**Go 内核**（基于 sing-box 1.14 的 neko 层分支）+ **Rust/Tauri 2 外壳** +
**统一的 React UI**：桌面端为应用窗口（已可用），路由器上为网页面板
（内核提供该面板并接受密码登录；OpenWrt 软件包不在本仓库中）。

> **状态：版本 0.9.3，仅发布 Windows 版。** 下表中的所有功能均已包含在发布版中。尚未完成或存在限制的部分见“开发中”一节。

---

## 功能

| 领域 | 包含内容 |
|---|---|
| **连接** | 系统代理（包括 Windows 的 VPN 连接）或 TUN，连接状态、当前服务器、经隧道的公网 IP。Kill switch：TUN 模式下为严格路由；代理模式下，根据代理设置，内核崩溃时不会解除代理。TUN 只能以管理员身份启动（没有单独的服务） |
| **服务器** | 导入链接（vmess/vless/ss/trojan/hysteria2/tuic/nekoray）、文件、订阅以及二维码（文件、剪贴板、屏幕截图），均需经过两阶段确认；显示二维码并导出链接；TCP ping、URL 测试和完整测试；搜索、克隆、在分组之间移动、删除不可用和重复的服务器、将域名解析为 IP；自定义的 outbound/config JSON 仅在通过 diff 确认后应用 |
| **订阅** | 创建和更新（逐个更新或一次性全部更新）、回滚订阅更新、有效期与流量、防止删除超过一半服务器的更新 |
| **路由** | 5 个内置预设（**LAV Preset RU**（默认）（Riot Games 域名固定走代理）、CN、全局、全部走代理、全部直连）以及自定义预设：复制内置预设、编辑列表和进程规则、导出与导入、导入 NekoRay 路由、根据连接创建规则。所选预设在（重新）连接时生效 |
| **DNS** | 简单模式（DoH/DoT/本地/自定义服务器）、高级 JSON、按预设分流 DNS、TUN 的 FakeIP |
| **连接与流量** | 状态栏显示速度，活动和已关闭连接（含字节数和规则），关闭连接，按配置和会话统计流量 |
| **从 NekoBox 迁移** | 查找 NekoBox 目录、预览，迁移分组、服务器、链式代理、路由和部分设置；重复迁移不产生重复项 |
| **备份** | `.lavbk` 文件包含所有数据（包括订阅和密钥），使用密码加密（Argon2id + XChaCha20-Poly1305）；恢复会完全替换现有数据 |
| **系统集成** | 开机自启（已安装版本通过带管理员权限的计划任务实现，使 TUN 在登录后立即可用；以管理员身份启动时自动切换为计划任务）、启动时自动连接到最近一次成功连接的服务器、关闭时最小化到托盘、以最小化方式启动、全局快捷键、通知、系统打开和保存对话框、记住窗口大小和位置 |
| **更新** | 更新中心：经签名的元数据和文件的 minisign 签名，支持断点续传下载，安装仅需一次 UAC 确认，支持回滚。0.9.x 版本中尚未配置（见“开发中”） |
| **诊断** | 自检、地址路由检查、隐藏密钥的内核日志、导出 sing-box 配置（附密钥风险提示） |
| **AI 智能体** | MCP 服务器 `lavray-core mcp`，提供“只读”和“读取和控制”两种模式：[`docs/MCP.md`](docs/MCP.md) |
| **平台** | Windows：NSIS 安装程序和便携版压缩包。Linux：外壳在 CI 中编译和测试，软件包尚未构建。macOS：内核可交叉编译，外壳未构建。OpenWrt：内核 `lavray-core-linux-{amd64,arm64}`（内置网页面板 `--web-bind` 和 TProxy 网关 `--platform openwrt`）随发布版提供；软件包（procd、LuCI、ipk/apk）尚未提供 |

## 开发中

以下功能尚未实现，或存在限制：

- 更新未配置：更新中心已就绪，但发布版中没有信任根。信任根由所有者通过密钥仪式创建（[`docs/UPDATE-SYSTEM.md`](docs/UPDATE-SYSTEM.md) §12.4）；在此之前，“更新”界面会显示“更新未配置”，新版本需手动安装；
- TUN 模式的服务（当前为以管理员身份运行）；内核崩溃时完全阻断流量（WFP）——仍在研究中；
- XHTTP 传输：链接可以导入并会做标记，但内核不支持该传输；
- `lavray://` 链接（deep link）；
- Linux 软件包（.deb、AppImage）和 macOS 构建；
- OpenWrt 软件包（procd、LuCI、ipk/apk）：规范见 [`docs/OPENWRT-PACKAGING.md`](docs/OPENWRT-PACKAGING.md)，构建在本仓库之外进行；
- 代码签名：安装程序未签名，Windows 会显示 SmartScreen。

---

## 仓库一览

| 仓库 | 用途 |
|---|---|
| **lavray**（本仓库） | 通用代码库：内核、外壳、UI、接口契约、设计系统、预设、文档 |
| [lavray-windows](https://github.com/anatolijlaptev1991-ctrl/lavray-windows) | Windows：发布版（NSIS 安装程序和 ZIP）、安装说明 |
| lavray-linux | Linux：.deb + AppImage（私有，开发中，暂无发布版） |
| lavray-macos | macOS：.dmg（私有，开发中，暂无发布版；未签名、未公证） |
| lavray-openwrt | OpenWrt：procd 服务、.ipk/.apk、网页面板、luci-app（私有，开发中，暂无发布版） |

---

## 目录结构

```
proto/       UI ↔ 内核接口契约（ConnectRPC）：13 个服务（RPC 与消息数量见 scripts/repo-stats.py）
core/        Go 内核（无 CGO）：
  internal/model        配置档案/分组/设置（NekoBox 的 bean 层级）
  internal/store        SQLite WAL，权限 0700/0600；NekoBox 目录导入器（store/nekoimport）
  internal/links        各协议链接解析器（模糊测试 FuzzParseLink、FuzzParseContent）
  internal/subs         订阅、从其他客户端导入、SSRF 防护
  internal/presets      5 个内置预设 + NekoRay 转换器 + golden RU
  internal/cfgbuild     sing-box 配置：golden 测试，与真实内核比对（CI 中的 singbox_check 标签）
  internal/inst         sing-box 实例管理器（FSM：Idle/Starting/Ready/Stopping/Crashed）
  internal/api          ConnectRPC 服务 + recover 拦截器（WebSessionService 仅在使用 `--web-bind` 时提供）
  internal/traffic      流量统计与连接速度
  internal/backup       加密备份（LAVBK1 格式）
  internal/textdiff     用于确认自定义 JSON 的 diff
  internal/web          网页面板：登录（Argon2id）、会话、CSRF/Origin、限流器、TLS、提供 ui/dist（`--web-bind` 参数）
  internal/logs         日志多路复用器 + 密钥掩码
  internal/updates      TUF-lite + minisign 更新客户端：校验、下载、staging
  internal/gateway      OpenWrt 网关：nftables 渲染、per-MAC、watchdog（由 `--platform openwrt` 启用）
  internal/headless     无 UI 的服务模式（--headless）：自动启动上次的配置档案、自动重启
  internal/mcp          面向 AI 智能体的 MCP 服务器（lavray-core mcp，基于 stdio）：docs/MCP.md
  cmd/lavray-core       内核进程：外壳的启动协议（§3）、一次性自动连接（`serve --connect-last`）
shell/       Rust/Tauri 2: 内核生命周期、系统代理、托盘、开机自启、全局快捷键、
             通知、对话框、更新安装与回滚
ui/          React + TS: 10 个界面，5 种语言（ru/en/zh/es/de），DS v1.2 设计令牌
presets/     内置预设（lav-ru/lav-cn/global/all-proxy/all-direct）
design/      v1.2 原型 + 验收脚本 + 截图
docs/        需求（FR-UI-001…281）、审计、缺陷、DS、更新、安全
scripts/     辅助脚本：文档检查、SPDX 头、仓库统计数据
```

---

## 构建

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File shell\build.ps1
```

脚本执行：`npm ci && npm run build`（UI）→ `go build`（内核，无 CGO）→ `cargo tauri build --bundles nsis`。结果为：`shell\target\release\bundle\nsis\LAVRay_<ver>_x64-setup.exe`。

要求：Go 1.27+、Node 24（与 CI 一致）、Rust stable（已在 1.96 上验证）、WebView2（Windows 10/11 自带）。

### Linux

```bash
./shell/build.sh     # .deb + AppImage
```

脚本已提供，但 Linux 软件包从未构建和验证：CI 只编译和测试外壳（ubuntu-24.04）。

### macOS

```bash
./shell/build.sh     # .app + .dmg (通用二进制：--target universal-apple-darwin)
```

未在 CI 中构建，也未手动构建过；内核可交叉编译为 darwin/arm64。

> v1 版本的构建**未签名**（所有者的决定）：Windows 会显示 SmartScreen，macOS 会显示 Gatekeeper。Windows 安装说明见 [lavray-windows](https://github.com/anatolijlaptev1991-ctrl/lavray-windows) 的 README。发布版中的 `SHA256SUMS.txt` 可用于校验文件完整性。签名元数据和 minisign 签名将在密钥仪式之后提供：CI 中的签名已就绪，但目前还没有密钥（`docs/UPDATE-SYSTEM.md`，“实现状态”）。

### 开发

```bash
cd ui && npm run dev            # 在浏览器中运行 UI（需单独启动内核）
cd ui && npx vitest run         # UI 测试
cd core && go test ./...        # 内核测试
cd shell && cargo test          # 外壳测试
python scripts/repo-stats.py    # 可验证的数字：契约、占位实现、词典键
```

---

## 安全

- 更新（`internal/updates`、`shell/src/update`）：TUF-lite 元数据（ed25519 签名、单调递增的 serial、timestamp 有效期不超过 7 天、防降级攻击）以及每个文件的 minisign 签名；安装前会再次校验文件。受信根密钥只有一个（阈值为 1，“2-of-3”属于下一阶段，见 `docs/UPDATE-SYSTEM.md` §3.1）。在 0.9.x 版本中没有信任根，因此更新未配置。
- 自定义 outbound/config JSON 仅在通过 diff 确认后才会应用；确认与内容哈希绑定，任何修改都会使其失效。
- 备份使用密码加密（Argon2id + XChaCha20-Poly1305）；遗忘的密码无法找回。
- 密钥在接收日志行时即被掩码处理（`logs.Redact`）。
- 订阅：SSRF 防护（禁止私有地址，将 IP 固定以防御 DNS 重绑定），限制响应大小，订阅和链接中的自定义字段会被丢弃。
- 网页面板（`--web-bind`）：Argon2id 密码、`HttpOnly; SameSite=Strict` Cookie（通过 HTTPS 时附加 `Secure`）、CSRF 头和 Origin 检查、按账户、按地址以及全局的尝试次数限制器、带稳定指纹的自签名 TLS（`--web-tls`）。非回环地址仅在使用 `--web-allow-remote` 时可用。通过 HTTP 访问时界面显示“不安全”。在非回环地址上进行首次设置需要数据目录中 `web-setup-code` 文件（权限 0600）里的一次性代码，因此网络中的随机客户端无法占用管理员权限。

安全政策与联系方式：[`docs/SECURITY.md`](docs/SECURITY.md)。

---

## 文档

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — 281 项 FR 功能需求
- [`docs/BUGS.md`](docs/BUGS.md) — LNB 缺陷目录及其修复状态
- [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) — 设计系统 v1.2
- [`docs/UPDATE-SYSTEM.md`](docs/UPDATE-SYSTEM.md) — TUF-lite v2.0
- [`docs/MCP.md`](docs/MCP.md) — AI 智能体访问（Claude Desktop、Claude Code、Cursor）
- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) · [`docs/TEST-PLAN.md`](docs/TEST-PLAN.md)
- [`docs/FIX-REPORT.md`](docs/FIX-REPORT.md) — 审计验收
- [`docs/HISTORY-REWRITE.md`](docs/HISTORY-REWRITE.md) — 历史重写与发布版哈希
- [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md) — 发布检查清单
- [`docs/RELEASE-NOTES-windows-v0.9.3.md`](docs/RELEASE-NOTES-windows-v0.9.3.md) — 0.9.3 的新增内容
- [`docs/stage3/core-port-plan.md`](docs/stage3/core-port-plan.md) — W1–W8 计划
- [`docs/rust-migration/`](docs/rust-migration/) — 将内核迁移到 Rust 的计划（草案）

## 许可证

[GPL-3.0](LICENSE)。本项目派生自 nekoray（GPL-3.0）和 sing-box；内核版本在“关于 → 许可与组件”中注明。源文件均带有 `SPDX-License-Identifier: GPL-3.0-only` 标识行（`python scripts/add-spdx.py --check`）。
