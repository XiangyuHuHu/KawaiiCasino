$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lan-addresses.ps1')
$runtimePath = Join-Path (Split-Path -Parent $PSScriptRoot) '.runtime\lan'
# Holding this handle makes repeated launcher clicks safe: one helper per checkout.
try {
    $lockHandle = [IO.File]::Open((Join-Path $runtimePath 'watcher.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch [IO.IOException] { exit 0 }
try {
    [IO.File]::WriteAllText((Join-Path $runtimePath 'watcher.pid'), [string]$PID)
    while ($true) {
        try { Update-CasinoLanSnapshot -RuntimePath $runtimePath | Out-Null }
        catch { # Keep the old snapshot only until its lease expires; never claim it is fresh.
            $_.Exception.Message | Set-Content -LiteralPath (Join-Path $runtimePath 'watcher-error.log')
        }
        Start-Sleep -Seconds 3
    }
} finally { $lockHandle.Dispose() }
