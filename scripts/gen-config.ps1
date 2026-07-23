param(
    [Parameter(Mandatory = $true)]
    [string]$OutPath
)

# Fixed project salt. Change only manually in config.json when required.
$FixedSalt = 'S4ZsOVYnBkX2o5a0'

$cfg = @{
    listen = ':8000'
    salt   = $FixedSalt
    auth   = @{ admin = 'ChangeMeChangeMe' }
    log    = @{ level = 'info'; path = './logs'; days = 7 }
    data   = './data'
} | ConvertTo-Json -Depth 4

$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($OutPath, $cfg, $utf8)
Write-Output "config.json written: $OutPath (salt=$FixedSalt)"
