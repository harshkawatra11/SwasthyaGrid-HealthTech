# Starts SwasthyaGrid from a clean slate: backend (8080), dashboard (3000), CRM (3001).
#
# Every start archives the previous simulation state, so the world always begins
# at the scenario start (08:30 IST, 0 delivered) and never continues from where
# a previous session stopped. Run from anywhere:  powershell -File scripts\start-demo.ps1
# Add -SkipBuild to reuse the last dashboard build.

param([switch]$SkipBuild)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$crm = Join-Path $root "ai-healthcare-crm"
$logs = Join-Path $env:TEMP "swasthyagrid-logs"
New-Item -ItemType Directory -Force $logs | Out-Null

function Stop-Port([int]$port) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $id = $_.OwningProcess
    Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $id -or $_.ParentProcessId -eq $id } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}

function Wait-Http([string]$url, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0 -ErrorAction Stop; return $true }
    catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -lt 500) { return $true } }
    Start-Sleep -Seconds 2
  }
  return $false
}

Write-Host "1/5 Stopping anything already running on 8080, 3000, 3001"
foreach ($p in 3000, 3001, 8080) { Stop-Port $p }

Write-Host "2/5 Archiving old simulation state so shipments restart from zero"
$runtime = Join-Path $backend ".runtime"
if (Test-Path $runtime) {
  $old = Join-Path $runtime "old"
  New-Item -ItemType Directory -Force $old | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  Get-ChildItem $runtime -File -Filter "logistics_*" -ErrorAction SilentlyContinue |
    ForEach-Object { Move-Item $_.FullName (Join-Path $old "$($_.BaseName)-$stamp$($_.Extension)") -Force }
}

Write-Host "3/5 Starting backend on 8080"
$py = Join-Path $backend ".venv\Scripts\python.exe"
Start-Process -FilePath $py -WorkingDirectory $backend -WindowStyle Hidden `
  -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080" `
  -RedirectStandardOutput (Join-Path $logs "backend.log") -RedirectStandardError (Join-Path $logs "backend.err.log")
if (-not (Wait-Http "http://127.0.0.1:8080/health" 60)) { throw "Backend did not come up. See $logs\backend.err.log" }

Write-Host "4/5 Starting dashboard on 3000"
if (-not $SkipBuild -or -not (Test-Path (Join-Path $frontend ".next\BUILD_ID"))) {
  Push-Location $frontend
  npm run build *> (Join-Path $logs "frontend-build.log")
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Dashboard build failed. See $logs\frontend-build.log" }
  Pop-Location
}
Start-Process -FilePath "cmd.exe" -WorkingDirectory $frontend -WindowStyle Hidden `
  -ArgumentList "/c", "npx next start -p 3000" `
  -RedirectStandardOutput (Join-Path $logs "frontend.log") -RedirectStandardError (Join-Path $logs "frontend.err.log")
if (-not (Wait-Http "http://127.0.0.1:3000/command" 60)) { throw "Dashboard did not come up. See $logs\frontend.err.log" }

Write-Host "5/5 Starting CRM on 3001"
# A force-stopped Next dev server can leave a corrupt cache that makes every page return 500.
# It is a disposable, gitignored cache and the server is stopped here, so clear it.
Remove-Item -Recurse -Force (Join-Path $crm ".next") -ErrorAction SilentlyContinue
Start-Process -FilePath "cmd.exe" -WorkingDirectory $crm -WindowStyle Hidden `
  -ArgumentList "/c", "npm run dev" `
  -RedirectStandardOutput (Join-Path $logs "crm.log") -RedirectStandardError (Join-Path $logs "crm.err.log")
$crmUp = Wait-Http "http://127.0.0.1:3001/" 90

$k = Invoke-RestMethod "http://127.0.0.1:8080/api/v1/logistics/kpis"
Write-Host ""
Write-Host "Backend   http://127.0.0.1:8080/docs"
Write-Host "Dashboard http://127.0.0.1:3000"
Write-Host ("CRM       http://127.0.0.1:3001  " + $(if ($crmUp) { "(up)" } else { "(still starting)" }))
Write-Host ("Fresh start check: delivered today = {0}, in transit = {1}, sim time = {2}" -f $k.delivered_today, $k.in_transit_now, $k.sim_now)
Write-Host "Logs: $logs"
