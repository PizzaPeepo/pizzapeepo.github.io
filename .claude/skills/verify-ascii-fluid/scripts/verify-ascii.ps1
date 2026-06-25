<#
.SYNOPSIS
  Headlessly screenshot + verify the FluidSimulation ASCII mode.

.DESCRIPTION
  Wraps the web-screenshot skill's capture.mjs. Two targets:
    test  -> FluidSimulation/asciiTest.html      (standalone before/after glyph-spacing harness)
    live  -> FluidSimulation/FluidSimulation.html (real WebGL pipeline, ASCII forced on at load)
  Runs from PowerShell on purpose: Git Bash mangles a leading-'/' --path into a Windows
  path, so capture.mjs fails with "Cannot navigate to invalid URL" under the Bash tool.

.EXAMPLE
  ./verify-ascii.ps1 -Target test
.EXAMPLE
  ./verify-ascii.ps1 -Target test -Gpx 13 -Scale 7 -Rows 4
.EXAMPLE
  ./verify-ascii.ps1 -Target live -Cols 28 -Splats 14
#>
param(
	[ValidateSet('test', 'live')] [string]$Target = 'test',
	[string]$Out,
	[int]$Wait,
	[int]$Width = 1300,
	[int]$Height = 760,
	# live knobs
	[int]$Cols,
	[int]$Splats = 14,
	[double]$Zoom,
	# test (asciiTest.html) knobs
	[int]$Gpx,
	[int]$Scale,
	[int]$Rows,
	[string]$CaptureMjs
)

$ErrorActionPreference = 'Stop'

# Repo root = four levels up from this script (.claude/skills/verify-ascii-fluid/scripts/).
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path

# Locate capture.mjs (the web-screenshot skill). Override with -CaptureMjs or $env:WEB_SCREENSHOT_MJS.
if (-not $CaptureMjs) { $CaptureMjs = $env:WEB_SCREENSHOT_MJS }
if (-not $CaptureMjs) {
	$cands = @(
		(Join-Path $env:USERPROFILE '.claude\skills\web-screenshot\capture.mjs'),
		(Join-Path $env:USERPROFILE '.claude\plugins\cache\*\skills\web-screenshot\capture.mjs')
	)
	foreach ($c in $cands) { $hit = Get-ChildItem $c -ErrorAction SilentlyContinue | Select-Object -First 1; if ($hit) { $CaptureMjs = $hit.FullName; break } }
}
if (-not $CaptureMjs -or -not (Test-Path $CaptureMjs)) {
	throw "capture.mjs not found. Pass -CaptureMjs <path> or set `$env:WEB_SCREENSHOT_MJS. Looked under ~/.claude/skills/web-screenshot/."
}

# Build the served path + query for the chosen target.
if ($Target -eq 'test') {
	$qs = @()
	if ($PSBoundParameters.ContainsKey('Gpx'))   { $qs += "gpx=$Gpx" }
	if ($PSBoundParameters.ContainsKey('Scale')) { $qs += "scale=$Scale" }
	if ($PSBoundParameters.ContainsKey('Rows'))  { $qs += "rows=$Rows" }
	$path = '/FluidSimulation/asciiTest.html' + ($(if ($qs) { '?' + ($qs -join '&') } else { '' }))
	if (-not $Wait) { $Wait = 3000 }
} else {
	$qs = @('ascii=1')
	if ($PSBoundParameters.ContainsKey('Cols')) { $qs += "cols=$Cols" }
	if ($PSBoundParameters.ContainsKey('Zoom')) { $qs += "zoom=$Zoom" }
	$qs += "splats=$Splats"
	$path = '/FluidSimulation/FluidSimulation.html?' + ($qs -join '&')
	if (-not $Wait) { $Wait = 7000 }   # let the splats advect into visible dye before the grab
}

if (-not $Out) {
	$dir = Join-Path $env:TEMP 'verify-ascii'
	if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
	$Out = Join-Path $dir ("ascii_{0}_{1}.png" -f $Target, (Get-Date -Format 'HHmmss'))
}

Write-Host "repo : $repoRoot"
Write-Host "path : $path"
Write-Host "out  : $Out"
node $CaptureMjs --root $repoRoot --path $path --out $Out --wait $Wait --width $Width --height $Height
