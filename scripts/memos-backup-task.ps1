param(
    [string]$ApiBase = "http://localhost:5230",
    [Parameter(Mandatory = $true)]
    [string]$PatToken,
    [string]$BackupDir = "E:\bak\Backups\memos_bak",
    [int]$RetainDays = 30
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

$timeSuffix = Get-Date -Format "yyyyMMdd_HHmmss"
$zipPath = Join-Path -Path $BackupDir -ChildPath "memos-backup-$timeSuffix.zip"

$headers = @{
    Authorization = "Bearer $PatToken"
}

Invoke-WebRequest `
    -Uri "$ApiBase/api/v1/instance/backup:download" `
    -Headers $headers `
    -OutFile $zipPath

if ($RetainDays -gt 0) {
    $expired = (Get-Date).AddDays(-$RetainDays)
    Get-ChildItem -Path $BackupDir -Filter "memos-backup-*.zip" |
        Where-Object { $_.LastWriteTime -lt $expired } |
        Remove-Item -Force
}
