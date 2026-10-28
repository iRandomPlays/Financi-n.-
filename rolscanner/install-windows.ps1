# Installeert de rolscanner op Windows: haalt de map op, maakt rolscanner.config.json, test de verbinding met de bridge
# en maakt start-rolscanner.bat. Bestaande config wordt behouden. Het token wordt alleen op deze pc bewaard.
$ErrorActionPreference = 'Stop'
$branch = 'ccr-07122be8-fap75g'
$repoZip = "https://github.com/iRandomPlays/Financi-n.-/archive/refs/heads/$branch.zip"
$dest = Join-Path $env:USERPROFILE 'rolscanner'

function Write-Utf8NoBom([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false))
}

Write-Host "Rolscanner installeren in $dest" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is niet gevonden. Installeer Node 20 of nieuwer van https://nodejs.org en start dit script opnieuw.'
}
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 20) { throw "Node $major is te oud; installeer Node 20 of nieuwer." }
if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
  Write-Warning 'De Codex CLI (commando "codex") is niet gevonden. Foto''s lezen werkt pas als Codex is geïnstalleerd en ingelogd. Je kunt alvast verder.'
}

$zip = Join-Path $env:TEMP 'rolscanner.zip'
$tmp = Join-Path $env:TEMP 'rolscanner-uitpakken'
Write-Host 'Downloaden...'
Invoke-WebRequest -UseBasicParsing $repoZip -OutFile $zip
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive $zip $tmp
$src = Get-ChildItem $tmp -Directory | Select-Object -First 1
$cfgPath = Join-Path $dest 'rolscanner.config.json'
$oldCfg = $null
if (Test-Path $cfgPath) { $oldCfg = Get-Content $cfgPath -Raw }
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $src.FullName 'rolscanner\*') $dest -Recurse -Force
Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue

if ($oldCfg) {
  Write-Utf8NoBom $cfgPath $oldCfg
  Write-Host 'Bestaande rolscanner.config.json behouden.' -ForegroundColor Green
  $cfg = $oldCfg | ConvertFrom-Json
} else {
  $bridge = Read-Host 'Adres van de bridge [http://homeassistant.local:8100]'
  if (-not $bridge) { $bridge = 'http://homeassistant.local:8100' }
  $token = Read-Host 'Plak het token uit de bridge (onderdeel Pc-app)'
  if (-not $token) { throw 'Zonder token kan de rolscanner geen rollen opslaan. Start het script opnieuw.' }
  $cfg = [ordered]@{
    bridgeUrl    = $bridge.TrimEnd('/')
    token        = $token.Trim()
    labelBaseUrl = 'http://homeassistant.local:8100'
    host         = '0.0.0.0'
    port         = 8787
    codexBin     = 'codex'
    codexArgs    = @()
    timeoutSec   = 120
  }
  Write-Utf8NoBom $cfgPath ($cfg | ConvertTo-Json)
  Write-Host 'rolscanner.config.json aangemaakt.' -ForegroundColor Green
}

# Test: bereikt deze pc de bridge, en wordt het token geaccepteerd?
try {
  $r = Invoke-RestMethod -UseBasicParsing -TimeoutSec 15 -Uri ($cfg.bridgeUrl.TrimEnd('/') + '/api/quick-add/catalog') -Headers @{ Authorization = "Bearer $($cfg.token)" }
  Write-Host ("Bridge bereikbaar. Locaties: {0}; typen: {1}" -f ($r.locations -join ', '), $r.types.Count) -ForegroundColor Green
} catch {
  Write-Warning ("De bridge is niet bereikbaar of het token klopt niet: " + $_.Exception.Message)
  Write-Host 'Tip: vervang homeassistant.local in rolscanner.config.json door het IP-adres van je Home Assistant, of maak in de bridge een nieuw token aan.'
}

Write-Utf8NoBom (Join-Path $dest 'start-rolscanner.bat') "@echo off`r`ncd /d `"%~dp0`"`r`necho Rolscanner start. Open op je telefoon http://<ip-van-deze-pc>:8787`r`nnode rolscanner.mjs`r`npause`r`n"

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '192.168.*' } | Select-Object -First 1).IPAddress
Write-Host ''
Write-Host 'Klaar. Start de rolscanner met dubbelklikken op:' -ForegroundColor Cyan
Write-Host "  $dest\start-rolscanner.bat"
if ($ip) { Write-Host "Open daarna op je telefoon: http://${ip}:8787" }
Write-Host 'Windows vraagt bij de eerste start om netwerktoegang voor Node.js: kies alleen Privénetwerk.'
