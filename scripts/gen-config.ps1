param(
    [Parameter(Mandatory = $true)]
    [string]$OutPath
)

$salt = -join ((48..57 + 65..90 + 97..122 | Get-Random -Count 16 | ForEach-Object { [char]$_ }))
$cfg = @{
    listen = ':8000'
    salt   = $salt
    auth   = @{ admin = 'ChangeMeChangeMe' }
    log    = @{ level = 'info'; path = './logs'; days = 7 }
} | ConvertTo-Json -Depth 4

$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($OutPath, $cfg, $utf8)
Write-Output "config.json written: $OutPath"