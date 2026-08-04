$ErrorActionPreference = 'Stop'

$apiDir = Join-Path $PSScriptRoot '..\src\app\api'
if (-not (Test-Path $apiDir)) {
  $apiDir = 'D:\customer_service_agent-main\src\app\api'
}

$files = Get-ChildItem -Path $apiDir -Recurse -Filter 'route.ts' | ForEach-Object FullName
$total = $files.Count
$migrated = 0
$unmigrated = @()

$importPattern = "from '@/lib/api/with-api'"

foreach ($f in $files) {
  $c = [System.IO.File]::ReadAllText($f)
  if ($c -match [regex]::Escape($importPattern)) {
    $migrated++
  } else {
    $rel = $f.Replace((Resolve-Path $apiDir).Path + '\', '')
    $unmigrated += $rel
  }
}

Write-Host "TOTAL_ROUTE_FILES=$total"
Write-Host "MIGRATED=$migrated"
Write-Host "UNMIGRATED=$($unmigrated.Count)"
if ($unmigrated.Count -gt 0) {
  Write-Host "---UNMIGRATED---"
  $unmigrated | ForEach-Object { Write-Host $_ }
}
