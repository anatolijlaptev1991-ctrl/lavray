# build.ps1 — полная сборка LAVRay для Windows: UI → ядро → установщик.
# Использование: powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host '== UI: сборка' -ForegroundColor Cyan
Push-Location "$root/ui"
npm ci
npm run build
Pop-Location

Write-Host '== Ядро: сборка lavray-core.exe (реальный sing-box)' -ForegroundColor Cyan
Push-Location "$root/core"
$env:CGO_ENABLED = '0'
# Теги сборки хранятся в ОДНОМ месте — core/BUILD_TAGS (T-02): singbox_run —
# настоящий раннер sing-box; with_quic — hysteria2/TUIC; with_gvisor — стек
# TUN; with_utls — REALITY и любой профиль с fp=. Копировать список в другие
# скрипты и workflow нельзя: тест core/internal/buildtags это проверяет.
$tags = (Get-Content "$root/core/BUILD_TAGS" -Raw).Trim()
if ($tags -eq '') { throw 'core/BUILD_TAGS пуст' }
go build -tags $tags -trimpath -ldflags '-s -w' -o "$root/shell/binaries/lavray-core.exe" ./cmd/lavray-core/
if ($LASTEXITCODE -ne 0) { throw 'ядро не собралось' }
$size = [math]::Round((Get-Item "$root/shell/binaries/lavray-core.exe").Length / 1MB, 1)
Write-Host "   lavray-core.exe: $size MB" -ForegroundColor DarkGray
Pop-Location

Write-Host '== Оболочка: установщик NSIS' -ForegroundColor Cyan
Push-Location "$root/shell"
cargo tauri build --bundles nsis
Pop-Location

Write-Host '== Готово:' -ForegroundColor Green
Get-ChildItem "$root/shell/target/release/bundle/nsis/*.exe" | Format-Table Name, Length
