$ErrorActionPreference = "Stop"
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# Login
Write-Host "=== Step 1: Login ===" -ForegroundColor Cyan
$loginResp = Invoke-WebRequest -Uri "http://localhost:5000/api/auth/login" -Method POST -ContentType "application/json; charset=utf-8" -Body '{"email":"admin@smartassist.com","password":"Admin123456"}' -UseBasicParsing -WebSession $session
Write-Host "Login response: $($loginResp.StatusCode)"

# Create simulation
Write-Host "`n=== Step 2: Create Simulation ===" -ForegroundColor Cyan
$simResp = Invoke-WebRequest -Uri "http://localhost:5000/api/simulations" -Method POST -ContentType "application/json; charset=utf-8" -Body '{}' -UseBasicParsing -WebSession $session
$simData = $simResp.Content | ConvertFrom-Json
$sessionId = $simData.conversation.id
Write-Host "Session ID: $sessionId"

# Test product query with SSE streaming
Write-Host "`n=== Step 3: Product Query SSE Test ===" -ForegroundColor Cyan
$msgResp = Invoke-WebRequest -Uri "http://localhost:5000/api/simulations/$sessionId/messages" -Method POST -ContentType "application/json; charset=utf-8" -Body '{"message":"请问纯棉圆领短袖T恤的价格是多少？"}' -UseBasicParsing -WebSession $session

# Parse SSE response
$content = $msgResp.Content
Write-Host "Response length: $($content.Length)"

# Extract done event and sources
if ($content -match 'data:\s*(\{[^}]*\"done\":\s*true[^}]*\})') {
    Write-Host "`n=== Found done event ===" -ForegroundColor Green
    $doneEvent = $Matches[1]
    Write-Host $doneEvent
    
    # Check for sources
    if ($doneEvent -match '\"sources\":\s*\[(.*?)\]') {
        Write-Host "`n=== Sources found ===" -ForegroundColor Green
        Write-Host "Sources: [$($Matches[1])]"
    } else {
        Write-Host "`n=== No sources in done event ===" -ForegroundColor Yellow
    }
} else {
    Write-Host "`n=== Raw Response ===" -ForegroundColor Yellow
    Write-Host $content
}

# Test size recommendation
Write-Host "`n=== Step 4: Size Recommendation SSE Test ===" -ForegroundColor Cyan
$sizeResp = Invoke-WebRequest -Uri "http://localhost:5000/api/simulations/$sessionId/messages" -Method POST -ContentType "application/json; charset=utf-8" -Body '{"message":"我身高170cm体重65kg，应该选什么尺码？"}' -UseBasicParsing -WebSession $session

$sizeContent = $sizeResp.Content
Write-Host "Size response length: $($sizeContent.Length)"

if ($sizeContent -match 'data:\s*(\{[^}]*\"done\":\s*true[^}]*\})') {
    Write-Host "`n=== Found done event ===" -ForegroundColor Green
    $sizeDoneEvent = $Matches[1]
    Write-Host $sizeDoneEvent
    
    if ($sizeDoneEvent -match '\"sources\":\s*\[(.*?)\]') {
        Write-Host "`n=== Sources found ===" -ForegroundColor Green
        Write-Host "Sources: [$($Matches[1])]"
    } else {
        Write-Host "`n=== No sources in done event ===" -ForegroundColor Yellow
    }
} else {
    Write-Host "`n=== Raw Size Response ===" -ForegroundColor Yellow
    Write-Host $sizeContent
}

Write-Host "`n=== Test Complete ===" -ForegroundColor Green
