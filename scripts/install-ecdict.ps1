param(
  [string]$DataDir = "C:\ProgramData\memos",
  [string]$WorkDir = "",
  [string]$CsvPath = "",
  [string]$SourceUrl = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($WorkDir)) {
  $WorkDir = Join-Path $env:TEMP "memos-ecdict"
}

$dictDir = Join-Path $DataDir "dictionaries"
$dbPath = Join-Path $dictDir "ecdict.db"

New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
New-Item -ItemType Directory -Path $dictDir -Force | Out-Null

if ([string]::IsNullOrWhiteSpace($CsvPath)) {
  $CsvPath = Join-Path $WorkDir "ecdict.csv"
  if (!(Test-Path -LiteralPath $CsvPath)) {
    Write-Host "Downloading ECDICT CSV..."
    Invoke-WebRequest -Uri $SourceUrl -OutFile $CsvPath
  }
}

Write-Host "Building dictionary database..."
Push-Location $repoRoot
try {
  go run .\scripts\ecdict\build-ecdict-db.go -csv $CsvPath -out $dbPath
} finally {
  Pop-Location
}

Write-Host "Dictionary database installed:"
Write-Host $dbPath
