# Test SmartAssist Product Query and Size Recommendation with SSE Streaming
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Create session variable for cookies
$cookies = New-Object System.Net.CookieContainer

# Step 1: Login
Write-Host "=== Step 1: Login ===" -ForegroundColor Cyan
$loginBody = '{"email":"admin@smartassist.com","password":"Admin123456"}'
$loginParams = @{
    Uri = "http://localhost:5000/api/auth/login"
    Method = "POST"
    ContentType = "application/json"
    Body = $loginBody
    CookieContainer = $cookies
    UseBasicParsing = $true
}
$loginResp = Invoke-RestMethod @loginParams
Write-Host "Login success: $($loginResp.success)"
Write-Host "User: $($loginResp.user.email)"

# Step 2: Create simulation session
Write-Host "`n=== Step 2: Create Simulation Session ===" -ForegroundColor Cyan
$simBody = '{}'
$simParams = @{
    Uri = "http://localhost:5000/api/simulations"
    Method = "POST"
    ContentType = "application/json"
    Body = $simBody
    CookieContainer = $cookies
    UseBasicParsing = $true
}
$simResp = Invoke-RestMethod @simParams
$sessionId = $simResp.conversation.id
Write-Host "Session ID: $sessionId"

# Step 3: Test Product Query with SSE streaming
Write-Host "`n=== Step 3: Product Query SSE Test ===" -ForegroundColor Cyan
$productBody = '{"message":"请问纯棉圆领短袖T恤的价格是多少？"}'
$productParams = @{
    Uri = "http://localhost:5000/api/simulations/$sessionId/messages"
    Method = "POST"
    ContentType = "application/json"
    Body = $productBody
    CookieContainer = $cookies
    UseBasicParsing = $true
}

try {
    $productResp = Invoke-RestMethod @productParams
    $productResp | ConvertTo-Json -Depth 10 | Out-File -FilePath "product_query_result.json" -Encoding UTF8
    Write-Host "Product query result saved to product_query_result.json"
    
    # Parse and analyze
    $productData = Get-Content "product_query_result.json" -Raw | ConvertFrom-Json
    if ($productData.sources) {
        Write-Host "`n=== Sources Found ===" -ForegroundColor Green
        $productData.sources | ForEach-Object {
            Write-Host "Type: $($_.type), Name: $($_.name)"
            Write-Host "Score: $($_.score)"
            Write-Host "Content (first 200 chars): $($_.content.Substring(0, [Math]::Min(200, $_.content.Length)))"
        }
    } else {
        Write-Host "`n=== No sources in response ===" -ForegroundColor Yellow
        Write-Host "Full response:"
        $productData | ConvertTo-Json -Depth 10
    }
} catch {
    Write-Host "Product query error: $_" -ForegroundColor Red
}

# Step 4: Test Size Recommendation with SSE streaming
Write-Host "`n=== Step 4: Size Recommendation SSE Test ===" -ForegroundColor Cyan
$sizeBody = '{"message":"我身高170cm体重65kg，应该选什么尺码？"}'
$sizeParams = @{
    Uri = "http://localhost:5000/api/simulations/$sessionId/messages"
    Method = "POST"
    ContentType = "application/json"
    Body = $sizeBody
    CookieContainer = $cookies
    UseBasicParsing = $true
}

try {
    $sizeResp = Invoke-RestMethod @sizeParams
    $sizeResp | ConvertTo-Json -Depth 10 | Out-File -FilePath "size_query_result.json" -Encoding UTF8
    Write-Host "Size query result saved to size_query_result.json"
    
    # Parse and analyze
    $sizeData = Get-Content "size_query_result.json" -Raw | ConvertFrom-Json
    if ($sizeData.sources) {
        Write-Host "`n=== Sources Found ===" -ForegroundColor Green
        $sizeData.sources | ForEach-Object {
            Write-Host "Type: $($_.type), Name: $($_.name)"
            Write-Host "Score: $($_.score)"
            Write-Host "Content (first 200 chars): $($_.content.Substring(0, [Math]::Min(200, $_.content.Length)))"
        }
    } else {
        Write-Host "`n=== No sources in response ===" -ForegroundColor Yellow
        Write-Host "Full response:"
        $sizeData | ConvertTo-Json -Depth 10
    }
} catch {
    Write-Host "Size query error: $_" -ForegroundColor Red
}

Write-Host "`n=== Test Complete ===" -ForegroundColor Green
