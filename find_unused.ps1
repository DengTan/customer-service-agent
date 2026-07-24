# Find unused components
 = @{}
Get-ChildItem -Path src -Recurse -Include *.ts,*.tsx | Where-Object { .Name -notmatch 'node_modules' } | ForEach-Object {
     = Get-Content .FullName -Raw
     = [regex]::Matches(, 'from\s+[\x27\x22]@/components/([^\x27\x22]+)[\x27\x22]')
    foreach ( in ) {
         = (.Groups[1].Value -split '/')[0]
        if (-not .ContainsKey()) { [] = @() }
        [] += .FullName
    }
}

 = @()
Get-ChildItem -Path src\components -Recurse -Include *.tsx -Exclude *.test.tsx | ForEach-Object {
     += .BaseName
}

Write-Host '=== UNUSED COMPONENTS ===' -ForegroundColor Yellow
 = 0
foreach ( in ) {
    if (-not .ContainsKey()) {
        Write-Host \ - \
        ++
    }
}
Write-Host ''
Write-Host \Total: \ -ForegroundColor Cyan
