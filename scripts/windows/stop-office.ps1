<#
.SYNOPSIS
  Stop what start-office.ps1 started, and nothing else.

.DESCRIPTION
  Reads %USERPROFILE%\.agent-office\win-office-pids.json. A pid is stopped
  only when the process with that pid still has the recorded start time and a
  command line containing the recorded script's full path (server\index.js,
  scripts\transcript-watch.mjs in this checkout), so a reused pid or any other node process is never
  touched. The transcript watcher's Python bridge exits on its own when its
  parent's pipe closes; it is stopped too if it is still a child of a
  tracked process. Logs to %USERPROFILE%\.agent-office\logs\start-office.log.
#>
[CmdletBinding()]
param()

$RuntimeDir = if ($env:AGENT_OFFICE_HOME) { $env:AGENT_OFFICE_HOME } else { Join-Path $env:USERPROFILE '.agent-office' }
$PidFile = Join-Path $RuntimeDir 'win-office-pids.json'
$LogDir = Join-Path $RuntimeDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'start-office.log'
function Write-Log([string]$msg) { Add-Content -Path $Log -Value ('{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg); Write-Verbose $msg }

function Get-StartKey($proc) { 'ticks:' + $proc.CreationDate.ToUniversalTime().Ticks }

if (-not (Test-Path $PidFile)) { Write-Log 'stop: nothing tracked'; return }
$tracked = @()
try { $tracked = @(Get-Content -Raw -Path $PidFile | ConvertFrom-Json) } catch { Write-Log 'stop: pid file unreadable, nothing stopped'; return }

foreach ($t in $tracked) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($t.pid)" -ErrorAction SilentlyContinue
  if (-not $p) { Write-Log "stop: $($t.name) ($($t.pid)) already gone"; continue }
  $sameStart = (Get-StartKey $p) -eq [string]$t.started
  $sameCmd = $p.CommandLine -like "*$($t.match)*"
  if (-not ($sameStart -and $sameCmd)) { Write-Log "stop: pid $($t.pid) is no longer $($t.name), left alone"; continue }
  # Children first (the tracker bridge under the watcher), only Python ones running tracker-bridge.py
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$($t.pid)" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*tracker-bridge.py*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; Write-Log "stop: tracker bridge $($_.ProcessId)" }
  Stop-Process -Id $t.pid -ErrorAction SilentlyContinue
  Write-Log "stop: $($t.name) ($($t.pid)) stopped"
}
Remove-Item -Path $PidFile -ErrorAction SilentlyContinue
