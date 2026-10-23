# Генерация иконок-заглушек LAVRay (shell/icons).
# Шеврон-глиф на тёмном фоне; замена на продакшн-иконку — при дизайне.
# Запуск из shell/:  powershell -NoProfile -ExecutionPolicy Bypass -File icons/gen-icons.ps1

Add-Type -AssemblyName System.Drawing

$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pngPath = Join-Path $outDir 'icon.png'
$icoPath = Join-Path $outDir 'icon.ico'

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(255, 24, 32, 48))

# Шеврон ">" — глиф LAVRay.
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 90, 220, 180), 26)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($pen, 96, 76, 172, 128)
$g.DrawLine($pen, 172, 128, 96, 180)
$g.Dispose()
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# ICO для Windows-ресурса (32x32).
$small = New-Object System.Drawing.Bitmap(32, 32)
$gs = [System.Drawing.Graphics]::FromImage($small)
$gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gs.DrawImage($bmp, 0, 0, 32, 32)
$gs.Dispose()
$icon = [System.Drawing.Icon]::FromHandle($small.GetHicon())
$fs = [System.IO.File]::Create($icoPath)
$icon.Save($fs)
$fs.Close()
$small.Dispose()
$bmp.Dispose()

Write-Host "icons written: $pngPath , $icoPath"
