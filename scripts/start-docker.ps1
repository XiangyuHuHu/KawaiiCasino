$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    $envPath = Join-Path $projectRoot '.env'
    $config = if (Test-Path -LiteralPath $envPath) { [IO.File]::ReadAllText($envPath) } else { '' }
    $portMatch = [regex]::Match($config, '(?m)^CASINO_PORT=(\d+)\s*$')
    $port = if ($portMatch.Success) { [int]$portMatch.Groups[1].Value } else { 4399 }
    if ($port -lt 1 -or $port -gt 65535) { throw 'Invalid CASINO_PORT in .env.' }
    # Keep only a port in configuration; never persist a discovered IP in .env.
    foreach ($setting in @("CASINO_PORT=$port", 'PUBLIC_URLS=')) {
        $key = $setting.Split('=')[0]
        if ([regex]::IsMatch($config, "(?m)^$key=")) {
            $config = [regex]::Replace($config, "(?m)^$key=[^\r\n]*", $setting)
        } else {
            $config = $config.TrimEnd() + "`r`n$setting`r`n"
        }
    }
    [IO.File]::WriteAllText($envPath, $config.Trim() + "`r`n", [Text.UTF8Encoding]::new($false))
    $runtimePath = Join-Path $projectRoot '.runtime\lan'
    New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $runtimePath 'config.json'), (@{ port = $port } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    . (Join-Path $PSScriptRoot 'lan-addresses.ps1')
    $urls = @(Update-CasinoLanSnapshot -RuntimePath $runtimePath)
    $watcherPath = Join-Path $PSScriptRoot 'watch-lan.ps1'
    Start-Process -FilePath 'powershell.exe' -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$watcherPath`"" -WindowStyle Hidden | Out-Null
    Write-Host 'Live LAN discovery enabled (refreshes every 3 seconds):'
    $urls | ForEach-Object { Write-Host "  $_" }
    & docker compose up -d --build --wait
    if ($LASTEXITCODE -ne 0) { throw 'Docker startup failed. Ensure Docker Desktop is running.' }
    Write-Host "Local browser: http://localhost:$port"
    Write-Host 'Wi-Fi changes update invitations automatically without restarting rooms.'
} finally {
    Pop-Location
}
