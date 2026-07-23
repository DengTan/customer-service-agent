#!/usr/bin/env bash
# =============================================================================
# verify-ai-processing-status.sh  (uses curl.exe on Windows)
# 验证 ai_processing 状态修复
# =============================================================================

BASE_URL="${BASE_URL:-http://localhost:5000}"
COOKIE_FILE="${TEMP:-/tmp}/ai_proc_test_cookies.txt"
EMAIL="${AI_PROC_TEST_EMAIL:-admin@smartassist.com}"
PASSWORD="${AI_PROC_TEST_PASSWORD:-Admin123456}"

# Clean up on exit
trap "rm -f '$COOKIE_FILE'" EXIT

echo "=== Step 1: Login ==="
LOGIN_RESP=$(curl.exe -s -c "$COOKIE_FILE" -b "$COOKIE_FILE" \
  -X POST "$BASE_URL/api/auth/login/" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" 2>&1)
echo "$LOGIN_RESP" | grep -o '"success":[^,}]*' || echo "Login response: $LOGIN_RESP"

echo ""
echo "=== Step 2: Create simulation ==="
CREATE_RESP=$(curl.exe -s -c "$COOKIE_FILE" -b "$COOKIE_FILE" \
  -X POST "$BASE_URL/api/simulations/" \
  -H "Content-Type: application/json" \
  -d '{"scenario_id":"test","scenario_name":"Test","title":"verify-test"}' 2>&1)
SIM_ID=$(echo "$CREATE_RESP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$SIM_ID" ]; then
  echo "ERROR: Failed to create simulation"
  echo "Response: $CREATE_RESP"
  exit 1
fi
echo "Created simulation ID: $SIM_ID"

echo ""
echo "=== Step 3: Check ai_processing BEFORE ==="
SIM_BEFORE=$(curl.exe -s -c "$COOKIE_FILE" -b "$COOKIE_FILE" \
  -X GET "$BASE_URL/api/simulations/$SIM_ID/")
echo "ai_processing before: $(echo "$SIM_BEFORE" | grep -o '"ai_processing":[^,}]*')"

echo ""
echo "=== Step 4: Send message (streaming SSE) ==="
echo "Waiting for SSE stream (timeout 65s)..."
STREAM_OUT=$(curl.exe -s -c "$COOKIE_FILE" -b "$COOKIE_FILE" \
  -X POST "$BASE_URL/api/simulations/$SIM_ID/messages/" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"content":"你好"}' \
  --max-time 65 2>&1) || true

echo "Stream output (first 300 chars):"
echo "$STREAM_OUT" | head -c 300
echo ""
if echo "$STREAM_OUT" | grep -q '"done":true'; then
  echo "[OK] Stream completed with done:true"
else
  echo "[NOTE] done:true not in stream (may be expected if LLM not configured)"
fi

echo ""
echo "=== Step 5: Check ai_processing AFTER ==="
sleep 1
SIM_AFTER=$(curl.exe -s -c "$COOKIE_FILE" -b "$COOKIE_FILE" \
  -X GET "$BASE_URL/api/simulations/$SIM_ID/")
AI_AFTER=$(echo "$SIM_AFTER" | grep -o '"ai_processing":[^,}]*')
echo "ai_processing after: $AI_AFTER"

if echo "$AI_AFTER" | grep -q '"ai_processing":false'; then
  echo "[PASS] ai_processing correctly cleared after stream!"
else
  echo "[FAIL] ai_processing should be false after stream, got: $AI_AFTER"
  exit 1
fi

echo ""
echo "=== Step 6: GET /messages includes ai_processing ==="
MSGS_RESP=$(curl.exe -s -c "$COOKIE_FILE" -b "$COOKIE_FILE" \
  -X GET "$BASE_URL/api/simulations/$SIM_ID/messages/")
if echo "$MSGS_RESP" | grep -q 'ai_processing'; then
  echo "[OK] GET /messages returns ai_processing field"
else
  echo "[FAIL] GET /messages missing ai_processing"
  exit 1
fi

echo ""
echo "=== Step 7: Cleanup ==="
curl.exe -s -c "$COOKIE_FILE" -b "$COOKIE_FILE" \
  -X DELETE "$BASE_URL/api/simulations/$SIM_ID/" > /dev/null 2>&1
echo "[OK] Deleted simulation"

echo ""
echo "=== All checks PASSED! ==="
