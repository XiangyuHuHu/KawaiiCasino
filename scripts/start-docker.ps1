$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    # Docker sees its VM interfaces, so discover LAN addresses on Windows first.
    # Ignore disconnected Ethernet, VPNs, virtual adapters and link-local IPs.
    $addresses = @(Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | ForEach-Object {
        Get-NetIPAddress -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -AddressState Preferred -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
            Select-Object -ExpandProperty IPAddress
    } | Sort-Object -Unique)
    if ($addresses.Count -eq 0) {
        throw 'No active physical LAN IPv4 address found. Connect Wi-Fi or Ethernet first.'
    }
    $envPath = Join-Path $projectRoot '.env'
    $config = if (Test-Path -LiteralPath $envPath) { [IO.File]::ReadAllText($envPath) } else { '' }
    $portMatch = [regex]::Match($config, '(?m)^CASINO_PORT=(\d+)\s*$')
    $port = if ($portMatch.Success) { [int]$portMatch.Groups[1].Value } else { 4399 }
    if ($port -lt 1 -or $port -gt 65535) { throw 'Invalid CASINO_PORT in .env.' }
    $urls = @($addresses | ForEach-Object { "http://${_}:$port" })
    foreach ($setting in @("CASINO_PORT=$port", "PUBLIC_URLS=$($urls -join ',')")) {
        $key = $setting.Split('=')[0]
        if ([regex]::IsMatch($config, "(?m)^$key=")) {
            $config = [regex]::Replace($config, "(?m)^$key=[^\r\n]*", $setting)
        } else {
            $config = $config.TrimEnd() + "`r`n$setting`r`n"
        }
    }
    [IO.File]::WriteAllText($envPath, $config.Trim() + "`r`n", [Text.UTF8Encoding]::new($false))
    Write-Host 'LAN invitation addresses refreshed:'
    $urls | ForEach-Object { Write-Host "  $_" }
    & docker compose up -d --build --wait
    if ($LASTEXITCODE -ne 0) { throw 'Docker startup failed. Ensure Docker Desktop is running.' }
    Write-Host "Local browser: http://localhost:$port"
    Write-Host 'Create a multiplayer room, then share its new invitation link.'
} finally {
    Pop-Location
}
