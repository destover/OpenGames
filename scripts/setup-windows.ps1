param([string]$ContainerAddress = "192.168.1.138")
$ErrorActionPreference = "Stop"
if (-not (Get-Command ssh -ErrorAction SilentlyContinue) -or -not (Get-Command ssh-keygen -ErrorAction SilentlyContinue)) {
    throw "Установите компонент OpenSSH Client в дополнительных компонентах Windows."
}
$sshDir = Join-Path $env:USERPROFILE ".ssh"
[IO.Directory]::CreateDirectory($sshDir) | Out-Null
$keyFile = Join-Path $sshDir "opengames_230_ed25519"
if (-not (Test-Path $keyFile)) {
    & ssh-keygen -t ed25519 -C "opengames-windows" -f $keyFile
    if ($LASTEXITCODE -ne 0) { throw "Не удалось создать SSH-ключ." }
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
$configFile = Join-Path $sshDir "config"
$content = if (Test-Path $configFile) { [IO.File]::ReadAllText($configFile) } else { "" }
$block = @"

Host opengames-230
    HostName $ContainerAddress
    User opengames-dev
    IdentityFile ~/.ssh/opengames_230_ed25519
    IdentitiesOnly yes
    StrictHostKeyChecking yes
    ServerAliveInterval 30
    ServerAliveCountMax 3
    LocalForward 127.0.0.1:3001 127.0.0.1:3001

"@
if ($content -notmatch "(?im)^\s*Host\s+.*\bopengames-230\b") {
    [IO.File]::WriteAllText($configFile, $content + $block, $utf8)
}
$resolved = & ssh -G opengames-230 2>$null
if (($resolved | Select-String "^hostname ").ToString() -ne "hostname $ContainerAddress") {
    throw "В SSH config уже есть opengames-230 с другим адресом. Проверьте $configFile"
}
$hostPublicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILJwvhMGmQujG6ZBktyP7N0o2JEqrXsxBMJ9VB24zQcv"
$knownHosts = Join-Path $sshDir "known_hosts"
$known = if (Test-Path $knownHosts) { [IO.File]::ReadAllText($knownHosts) } else { "" }
$line = "$ContainerAddress $hostPublicKey"
if (-not $known.Contains($line)) {
    [IO.File]::WriteAllText($knownHosts, $known.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine, $utf8)
}
$publicParts = (Get-Content "$keyFile.pub" -Raw).Trim() -split "\s+"
if ($publicParts.Length -lt 2 -or $publicParts[0] -ne "ssh-ed25519" -or $publicParts[1] -notmatch "^[A-Za-z0-9+/=]+$") {
    throw "Некорректный публичный ключ."
}
$publicKey = $publicParts[0] + " " + $publicParts[1] + " opengames-windows"
$enroll = 'pct exec 230 -- sh -c "umask 077; printf ''%s\n'' ''' + $publicKey + ''' >> /home/opengames-dev/.ssh/authorized_keys; chown opengames-dev:opengames-dev /home/opengames-dev/.ssh/authorized_keys; chmod 600 /home/opengames-dev/.ssh/authorized_keys"'
Write-Host ""
Write-Host "Выполните эту команду в консоли узла pve01 в Proxmox:" -ForegroundColor Cyan
Write-Host $enroll
Write-Host ""
Write-Host "Затем проверьте доступ с Windows: ssh opengames-230"
Write-Host "Проект в ChatGPT: /opt/opengames/project"
Write-Host "Инструкция: https://github.com/destover/OpenGames/blob/develop/docs/windows-remote.md"
