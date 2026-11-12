<#
.SYNOPSIS
  Start Claude Office (EA fork) on Windows with no console windows.

.DESCRIPTION
  Starts, hidden (no console window, detached through spawn-hidden.mjs) and
  at BelowNormal priority:
    1. the office server (node server\index.js), which also serves the built UI
    2. the transcript watcher (node scripts\transcript-watch.mjs): the hookless
       default that tails %USERPROFILE%\.claude\projects
  Optional: the chat AI watcher is NOT started here (it needs bash + claude -p;
  set AGENT_OFFICE_CHAT_AI=1 and run it yourself if you ever want it).

  Every process it starts is recorded in %USERPROFILE%\.agent-office\win-office-pids.json
  (pid, name, start time, command line). stop-office.ps1 stops exactly those
  processes and nothing else. No autostart, no scheduled task, no hooks.

  Run it through start-office.vbs to get no window at all (not even the
  PowerShell one). Logs: %USERPROFILE%\.agent-office\logs\.

.PARAMETER Build
  Rebuild the UI (vite build, hidden) even if dist\index.html exists.
.PARAMETER NoBrowser
  Do not open the office in the browser.
.PARAMETER Hooks
  Hook mode: do not start the transcript watcher (you installed the hooks yourself).
#>
[CmdletBinding()]
param(
  [switch]$Build,
  [switch]$NoBrowser,
  [switch]$Hooks
)

$ErrorActionPreference = 'Stop'
function P { [System.IO.Path]::Combine([string[]]$args) }
$Root = (Resolve-Path (P $PSScriptRoot '..' '..')).Path
$RuntimeDir = if ($env:AGENT_OFFICE_HOME) { $env:AGENT_OFFICE_HOME } else { Join-Path $env:USERPROFILE '.agent-office' }
$LogDir = Join-Path $RuntimeDir 'logs'
$PidFile = Join-Path $RuntimeDir 'win-office-pids.json'
$Port = if ($env:AGENT_OFFICE_PORT) { [int]$env:AGENT_OFFICE_PORT } else { 3334 }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'start-office.log'

function Write-Log([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $Log -Value $line
  Write-Verbose $line
}

# A process's start time as a plain string. Why ticks and not a date string:
# PowerShell 7's ConvertFrom-Json turns ISO date strings back into dates
function Get-StartKey($proc) { 'ticks:' + $proc.CreationDate.ToUniversalTime().Ticks }

# Run node inline with all output to a log. Why Continue: in Windows
# PowerShell 5.1 a native command's redirected stderr is an error record,
# which 'Stop' would turn into a failure even when node exits 0
function Invoke-NodeLogged([string]$logFile, [string[]]$nodeArgs) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Node @nodeArgs *> $logFile; return $LASTEXITCODE } finally { $ErrorActionPreference = $old }
}

function Test-Health {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:$Port/health"
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Get-Tracked {
  if (-not (Test-Path $PidFile)) { return @() }
  try { return @(Get-Content -Raw -Path $PidFile | ConvertFrom-Json) } catch { return @() }
}

function Test-TrackedAlive($t) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($t.pid)" -ErrorAction SilentlyContinue
  if (-not $p) { return $false }
  # Why both checks: a pid can be reused by an unrelated process after a reboot
  return ($p.CommandLine -like "*$($t.match)*") -and ((Get-StartKey $p) -eq [string]$t.started)
}

# Start one node script hidden (own hidden console, detached, BelowNormal,
# logs to files) through spawn-hidden.mjs; returns its record
function Start-Hidden([string]$name, [string]$script, [string]$match, [string[]]$extraArgs = @()) {
  $out = Join-Path $LogDir "$name.log"
  $err = Join-Path $LogDir "$name.err.log"
  $launcher = P $PSScriptRoot 'spawn-hidden.mjs'
  $res = & $Node $launcher $out $err $Node $script @extraArgs
  if ($LASTEXITCODE -ne 0 -or -not $res) { Write-Log "could not start $name"; throw "could not start $name, see $err" }
  $procId = [int](($res | Select-Object -Last 1) | ConvertFrom-Json).pid
  $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
  $started = if ($cim) { Get-StartKey $cim } else { '' }
  Write-Log "started $name pid $procId"
  return [pscustomobject]@{ name = $name; pid = $procId; started = $started; match = $match }
}

Write-Log "---- start (root $Root)"

$NodeCmd = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $NodeCmd) { Write-Log 'node.exe not found on PATH'; throw 'node.exe not found on PATH (install Node.js 20+)' }
$Node = $NodeCmd.Source

if (-not (Test-Path (P $Root 'node_modules'))) {
  Write-Log 'node_modules missing: run  npm ci  then  npm rebuild better-sqlite3 esbuild  (README-EA.md)'
  throw 'node_modules missing: run npm ci, then npm rebuild better-sqlite3 esbuild'
}

# First run: the EA config (project focus on EA Development)
$Config = P $Root 'office.config.json'
if (-not (Test-Path $Config)) {
  Copy-Item (P $Root 'office.config.ea.example.json') $Config
  Write-Log 'created office.config.json from office.config.ea.example.json'
}

# Keep what is still running from a previous start; forget the rest
$tracked = @(Get-Tracked | Where-Object { Test-TrackedAlive $_ })

# The UI, built once (the server serves dist\ itself, so no Vite dev server runs)
$Dist = P $Root 'dist' 'index.html'
if ($Build -or -not (Test-Path $Dist)) {
  Write-Log 'building the UI (vite build)'
  $vite = P $Root 'node_modules' 'vite' 'bin' 'vite.js'
  $code = Invoke-NodeLogged (Join-Path $LogDir 'build.log') @($vite, 'build')
  if ($code -ne 0) { Write-Log "vite build failed ($code), see logs\build.log"; throw 'UI build failed, see logs\build.log' }
}

if (-not ($tracked | Where-Object name -eq 'server') -and -not (Test-Health)) {
  $serverJs = P $Root 'server' 'index.js'
  $tracked += Start-Hidden 'server' $serverJs $serverJs
  for ($i = 0; $i -lt 40 -and -not (Test-Health); $i++) { Start-Sleep -Milliseconds 250 }
  if (-not (Test-Health)) { Write-Log 'server did not answer /health, see logs\server.err.log' }
} else { Write-Log 'server already running' }

$useHooks = $Hooks -or ($env:AGENT_OFFICE_SOURCE -eq 'hooks')
if (-not $useHooks -and -not ($tracked | Where-Object name -eq 'transcript-watch')) {
  $watchJs = P $Root 'scripts' 'transcript-watch.mjs'
  $tracked += Start-Hidden 'transcript-watch' $watchJs $watchJs
}

ConvertTo-Json -InputObject @($tracked) -Depth 3 | Set-Content -Path $PidFile -Encoding UTF8

if (-not $NoBrowser) {
  # open-office.mjs opens http://127.0.0.1:<port>/#token=... through a redirect page
  [void](Invoke-NodeLogged (Join-Path $LogDir 'open-office.log') @((P $Root 'scripts' 'open-office.mjs')))
}
Write-Log "running: $((@($tracked) | ForEach-Object { "$($_.name)=$($_.pid)" }) -join ', ')  office http://127.0.0.1:$Port/"
