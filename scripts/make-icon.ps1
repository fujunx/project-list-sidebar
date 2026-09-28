# One-off generator for the Marketplace icon: media/icon.png (128x128, transparent rounded tile).
# It reuses the folder silhouette from media/projects.svg so the activity-bar icon and the
# store icon share the same mark. Windows-only (System.Drawing); the PNG is committed, so the
# normal build never needs to run this.
#
#     powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1
#
param(
    [string]$OutFile = (Join-Path $PSScriptRoot "..\media\icon.png")
)

Add-Type -AssemblyName System.Drawing

$size = 128
$radius = 28.0
$bg = [System.Drawing.ColorTranslator]::FromHtml("#0F766E")
$fg = [System.Drawing.Color]::White

$bmp = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

# Rounded tile background.
$d = $radius * 2.0
$tile = [System.Drawing.Drawing2D.GraphicsPath]::new()
$tile.AddArc(0, 0, $d, $d, 180, 90)
$tile.AddArc($size - $d, 0, $d, $d, 270, 90)
$tile.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
$tile.AddArc(0, $size - $d, $d, $d, 90, 90)
$tile.CloseFigure()
$g.FillPath([System.Drawing.SolidBrush]::new($bg), $tile)

# Folder glyph, converted from the SVG path units (x 3..21, y 4..18.09) and centered.
$scale = 80.0 / 18.0
$originX = (($size - 80.0) / 2.0) - (3.0 * $scale)
$originY = (($size - (14.09 * $scale)) / 2.0) - (4.0 * $scale)

function Pt([double]$x, [double]$y) {
    return [System.Drawing.PointF]::new(
        [single]($originX + $x * $scale),
        [single]($originY + $y * $scale))
}

$folder = [System.Drawing.Drawing2D.GraphicsPath]::new()
$folder.AddLine((Pt 4.5 4), (Pt 8.59 4))
$folder.AddBezier((Pt 8.99 4), (Pt 9.37 4.16), (Pt 9.65 4.44), (Pt 9.65 4.44))
$folder.AddLine((Pt 9.65 4.44), (Pt 10.86 5.65))
$folder.AddBezier((Pt 11.14 5.93), (Pt 11.52 6.09), (Pt 11.92 6.09), (Pt 11.92 6.09))
$folder.AddLine((Pt 11.92 6.09), (Pt 19.5 6.09))
$folder.AddBezier((Pt 20.33 6.09), (Pt 21 6.76), (Pt 21 7.59), (Pt 21 7.59))
$folder.AddLine((Pt 21 7.59), (Pt 21 16.59))
$folder.AddBezier((Pt 21 17.42), (Pt 20.33 18.09), (Pt 19.5 18.09), (Pt 19.5 18.09))
$folder.AddLine((Pt 19.5 18.09), (Pt 4.5 18.09))
$folder.AddBezier((Pt 3.67 18.09), (Pt 3 17.42), (Pt 3 16.59), (Pt 3 16.59))
$folder.AddLine((Pt 3 16.59), (Pt 3 5.5))
$folder.AddBezier((Pt 3 4.67), (Pt 3.67 4), (Pt 4.5 4), (Pt 4.5 4))
$folder.CloseFigure()
$g.FillPath([System.Drawing.SolidBrush]::new($fg), $folder)

$g.Dispose()
$dir = Split-Path -Parent $OutFile
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Host "wrote $OutFile ($size x $size)"
