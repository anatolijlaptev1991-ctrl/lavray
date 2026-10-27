# build.ps1 — полная сборка LAVRay для Windows: UI → ядро → установщик.
# Использование: powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host '== UI: сборка' -ForegroundColor Cyan
Push-Location "$root/ui"
npm ci
npm run build
Pop-Location

Write-Host '== Ядро: сборка lavray-core.exe' -ForegroundColor Cyan
Push-Location "$root/core"
$env:CGO_ENABLED = '0'
go build -trimpath -ldflags '-s -w' -o "$root/shell/binaries/lavray-core.exe" ./cmd/lavray-core/
Pop-Location

Write-Host '== Оболочка: установщик NSIS' -ForegroundColor Cyan
Push-Location "$root/shell"
cargo tauri build --bundles nsis
Pop-Location

Write-Host '== Готово:' -ForegroundColor Green
Get-ChildItem "$root/shell/target/release/bundle/nsis/*.exe" | Format-Table Name, Length
