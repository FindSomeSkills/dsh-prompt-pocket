# Restart the DSH web host once and verify dsh-prompt-stash afterwards.
# Run by an external process (scheduled task or a double-clicked .cmd), never from
# inside the session it restarts.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File restart-and-verify.ps1
#
# Writes artifacts/restart-verify-<timestamp>.log and exits non-zero when the host
# does not come back or the pocket does not answer.

$ErrorActionPreference = 'Continue'
$port = 2081
$root = 'C:\Knowledge base\02-Project\dsh-prompt-stash'
$artifacts = Join-Path $root 'artifacts'
New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logPath = Join-Path $artifacts "restart-verify-$stamp.log"

function Say($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Output $line
  Add-Content -Path $logPath -Value $line -Encoding UTF8
}

Say 'restart: looking for the process listening on 2081'
$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $conn) {
  Say 'restart: no listener, skipping the kill'
} else {
  $oldPid = $conn.OwningProcess
  Say "restart: stopping pid $oldPid"
  Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
}

Say 'restart: starting the DSH021-Web task'
schtasks /run /tn DSH021-Web | Out-Null

$up = $false
for ($i = 1; $i -le 90; $i++) {
  Start-Sleep -Seconds 1
  $probe = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $probe) { $up = $true; Say "restart: port $port listening after ${i}s (pid $($probe.OwningProcess))"; break }
}
if (-not $up) {
  Say 'FAIL: host did not listen within 90s'
  exit 2
}

Start-Sleep -Seconds 2
$base = "http://127.0.0.1:$port/dsh-prompt-stash"
$failures = 0

function Check($name, [scriptblock]$body) {
  try {
    $value = & $body
    Say "PASS: $name"
    return $value
  } catch {
    $script:failures += 1
    Say "FAIL: $name — $($_.Exception.Message)"
    return $null
  }
}

$state = Check 'GET /state answers 200 with cap 500' {
  $r = Invoke-WebRequest -Uri "$base/state" -UseBasicParsing -TimeoutSec 10
  if ($r.StatusCode -ne 200) { throw "status $($r.StatusCode)" }
  $j = $r.Content | ConvertFrom-Json
  if ($j.cap -ne 500) { throw "cap $($j.cap)" }
  $j
}

$saved = Check 'POST /mutate save writes one entry' {
  $body = @{ op = 'save'; text = 'restart self-check entry'; scope = 'global'; source = 'manual' } | ConvertTo-Json -Compress
  $r = Invoke-WebRequest -Uri "$base/mutate" -Method Post -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 10
  if ($r.StatusCode -ne 200) { throw "status $($r.StatusCode)" }
  ($r.Content | ConvertFrom-Json)
}

if ($null -ne $saved -and $saved.entry -and $saved.entry.id) {
  Check 'POST /mutate remove deletes it again' {
    $body = @{ op = 'remove'; id = $saved.entry.id } | ConvertTo-Json -Compress
    $r = Invoke-WebRequest -Uri "$base/mutate" -Method Post -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -ne 200) { throw "status $($r.StatusCode)" }
    $true
  } | Out-Null
}

Check 'POST /polish reaches the model or refuses cleanly' {
  $body = @{ text = 'Compress this daily report into three bullets, no adjectives, under twenty words each.' } | ConvertTo-Json -Compress
  try {
    $r = Invoke-WebRequest -Uri "$base/polish" -Method Post -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 40
    if ($r.StatusCode -eq 200) {
      $j = $r.Content | ConvertFrom-Json
      if (-not $j.text) { throw 'empty text' }
      Say "polish: model returned $($j.text.Length) chars"
      return $true
    }
    throw "unexpected status $($r.StatusCode)"
  } catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($code -eq 502 -or $code -eq 503) { Say "polish: host refused with $code (no model or rewrite rejected)"; return $true }
    throw
  }
} | Out-Null

# A client-only check: the page itself is authenticated, so the GUI is verified by
# the user. Here we only prove the host half came back on the right version.
Check 'installed copy reports 0.2.0' {
  $p = Join-Path 'C:\Users\LIUY\.dsh\profiles\web\node_modules\dsh-prompt-stash\package.json'
  $j = Get-Content $p -Raw | ConvertFrom-Json
  if ($j.version -ne '0.2.0') { throw "version $($j.version)" }
  $true
} | Out-Null

if ($failures -gt 0) {
  Say "RESULT: $failures check(s) failed. Log: $logPath"
  exit 1
}
Say "RESULT: all checks passed. Log: $logPath"
exit 0
