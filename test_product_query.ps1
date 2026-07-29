# Test SmartAssist Product Query and Size Recommendation
$ErrorActionPreference = "Continue"

# Step 1: Login
Write-Host "=== Step 1: Login ===" -ForegroundColor Cyan
$loginResult = Invoke-RestMethod -Uri "http://localhost:5000/api/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"admin@smartassist.com","password":"Admin123456"}' -SessionVariable session
$session | ConvertTo-Json

# Step 2: Create Simulation Session
Write-Host "`n=== Step 2: Create Simulation Session ===" -ForegroundColor Cyan
$createResult = Invoke-RestMethod -Uri "http://localhost:5000/api/simulations" -Method Post -ContentType "application/json" -Body "{}" -WebSession $session
$sessionId = $createResult.conversation.id
Write-Host "Session ID: $sessionId"

# Step 3: Test Product Query
Write-Host "`n=== Step 3: Test Product Query ===" -ForegroundColor Cyan
$queryBody = @{
    message = "请问纯棉圆领短袖T恤的价格是多少？"
} | ConvertTo-Json

$productQueryResult = Invoke-RestMethod -Uri "http://localhost:5000/api/simulations/$sessionId/messages" -Method Post -ContentType "application/json" -Body $queryBody -WebSession $session
$productQueryResult | ConvertTo-Json -Depth 10

# Step 4: Test Size Recommendation
Write-Host "`n=== Step 4: Test Size Recommendation ===" -ForegroundColor Cyan
$sizeBody = @{
    message = "我身高170cm体重65kg，应该选什么尺码？"
} | ConvertTo-Json

$sizeResult = Invoke-RestMethod -Uri "http://localhost:5000/api/simulations/$sessionId/messages" -Method Post -ContentType "application/json" -Body $sizeBody -WebSession $session
$sizeResult | ConvertTo-Json -Depth 10

Write-Host "`n=== Test Complete ===" -ForegroundColor Green
