function Update-CasinoLanSnapshot {
    param([string]$RuntimePath)
    $config = Get-Content -LiteralPath (Join-Path $RuntimePath 'config.json') -Raw | ConvertFrom-Json
    $port = [int]$config.port
    if ($port -lt 1 -or $port -gt 65535) { throw 'Invalid LAN port.' }
    $addresses = @(Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | ForEach-Object {
        Get-NetIPAddress -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -AddressState Preferred -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notmatch '^(0\.|127\.|169\.254\.)' } |
            Select-Object -ExpandProperty IPAddress
    } | Sort-Object -Unique | ForEach-Object { "http://${_}:$port" })
    $snapshot = @{ updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); addresses = $addresses }
    $temporaryPath = Join-Path $RuntimePath ('lan-' + [guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($temporaryPath, ($snapshot | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporaryPath -Destination (Join-Path $RuntimePath 'lan-addresses.json') -Force
    return $addresses
}
