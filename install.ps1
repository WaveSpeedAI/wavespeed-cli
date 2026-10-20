# WaveSpeed CLI installer for Windows (no Node.js needed)
#   irm https://raw.githubusercontent.com/WaveSpeedAI/wavespeed-cli/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$asset = "wavespeed-windows-$arch.exe"
$base = 'https://github.com/WaveSpeedAI/wavespeed-cli/releases/latest/download'
$dir = if ($env:WAVESPEED_INSTALL_DIR) { $env:WAVESPEED_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'wavespeed' }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$tmp = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host "Downloading $asset..."
  Invoke-WebRequest "$base/$asset" -OutFile "$tmp\$asset"
  Invoke-WebRequest "$base/SHA256SUMS" -OutFile "$tmp\SHA256SUMS"
  $line = Get-Content "$tmp\SHA256SUMS" | Where-Object { ($_ -split '\s+')[1] -replace '^\*', '' -eq $asset } | Select-Object -First 1
  $want = ($line -split '\s+')[0]
  $got = (Get-FileHash "$tmp\$asset" -Algorithm SHA256).Hash.ToLower()
  if (-not $want -or $want.ToLower() -ne $got) { throw 'Checksum mismatch - not installing.' }
  Copy-Item "$tmp\$asset" (Join-Path $dir 'wavespeed.exe') -Force
} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $dir) {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$dir", 'User')
  Write-Host "Added $dir to your PATH - open a new terminal."
}
Write-Host "Installed. Next: wavespeed login"
