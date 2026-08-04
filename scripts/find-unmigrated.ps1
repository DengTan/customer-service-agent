$ErrorActionPreference = "SilentlyContinue"
$results = @()

Get-ChildItem -Path "src/app/api" -Recurse -Filter "route.ts" | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    if ($content -notmatch "from '@/lib/api/with-api'") {
        $results += $_.FullName
    }
}

Write-Host "TOTAL_UNMIGRATED=$($results.Count)"
Write-Host "---FILES---"
$results | ForEach-Object { Write-Host $_ }
