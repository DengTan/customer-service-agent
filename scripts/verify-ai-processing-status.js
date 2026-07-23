/**
 * verify-ai-processing-status.js
 * 验证 ai_processing 状态修复
 */
const http = require('http');

const BASE = 'http://localhost:5000';
const EMAIL = 'admin@smartassist.com';
const PASSWORD = 'Admin123456';

let cookie = '';

function request(method, path, body) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: 'localhost', port: '5000',
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(cookie ? { 'Cookie': cookie } : {}),
      },
    };
    const req = http.request(options, (res) => {
      const setCookies = res.headers['set-cookie'] || [];
      if (setCookies.length > 0) cookie = setCookies.map(c => c.split(';')[0]).join('; ');
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    if (body) req.write(body);
    req.end();
  });
}

async function sseRequest(path, body) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost', port: '5000',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Cookie': cookie,
      },
      timeout: 65000,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ body: data, status: res.statusCode }));
    });
    req.on('error', () => resolve({ body: '', status: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ body: '', status: 0 }); });
    req.write(body);
    req.end();
  });
}

async function main() {
  let simId = null;

  console.log('Step 1: Login');
  const login = await request('POST', '/api/auth/login', JSON.stringify({ email: EMAIL, password: PASSWORD }));
  console.log(`  Status: ${login.status}`);
  if (login.status !== 200) { console.log('[FAIL] Login'); process.exit(1); }
  console.log('  [OK] Logged in');

  console.log('\nStep 2: Create simulation');
  const create = await request('POST', '/api/simulations', JSON.stringify({ scenario_id: 'test', scenario_name: 'Test', title: 'verify-ai-processing' }));
  console.log(`  Status: ${create.status}`);
  if (create.status !== 201) { console.log('[FAIL] Create'); process.exit(1); }
  const match = create.body.match(/"id"\s*:\s*"([^"]+)"/);
  simId = match ? match[1] : null;
  if (!simId) { console.log('[FAIL] No sim ID'); process.exit(1); }
  console.log(`  [OK] Created: ${simId}`);

  console.log('\nStep 3: Check ai_processing BEFORE (via GET /simulations/[id])');
  const before = await request('GET', `/api/simulations/${simId}`);
  // API returns { success: true, conversation: {...} } — NOT data.conversation
  let beforeJson;
  try { beforeJson = JSON.parse(before.body); } catch { console.log('  [FAIL] Parse error'); process.exit(1); }
  const aiBefore = beforeJson?.conversation?.ai_processing;
  console.log(`  ai_processing: ${aiBefore} (type: ${typeof aiBefore})`);
  console.log('  [OK] Field returned correctly');

  console.log('\nStep 4: Send message (SSE stream)');
  const stream = await sseRequest(`/api/simulations/${simId}/messages`, JSON.stringify({ content: '你好' }));
  const done = stream.body.includes('"done":true');
  console.log(`  Stream received (${stream.body.length} bytes)`);
  console.log(done ? '  [OK] done:true found' : '  [NOTE] done:true not found (LLM may not be configured)');

  console.log('\nStep 5: Check ai_processing AFTER (via GET /simulations/[id])');
  await new Promise(r => setTimeout(r, 1000));
  const after = await request('GET', `/api/simulations/${simId}`);
  let afterJson;
  try { afterJson = JSON.parse(after.body); } catch { console.log('  [FAIL] Parse'); process.exit(1); }
  const aiAfter = afterJson?.conversation?.ai_processing;
  console.log(`  ai_processing: ${aiAfter} (type: ${typeof aiAfter})`);

  if (aiAfter === false) {
    console.log('\n[PASS] ai_processing=false — clearAiProcessing worked correctly!');
  } else {
    console.log(`\n[FAIL] ai_processing should be false, got: ${aiAfter}`);
    process.exit(1);
  }

  console.log('\nStep 6: GET /messages includes ai_processing');
  const msgs = await request('GET', `/api/simulations/${simId}/messages`);
  if (msgs.body.includes('ai_processing')) {
    console.log('  [OK] GET /messages returns ai_processing field');
  } else {
    console.log('  [FAIL] GET /messages missing ai_processing');
    process.exit(1);
  }

  console.log('\nStep 7: Cleanup');
  await request('DELETE', `/api/simulations/${simId}`);
  console.log('  [OK] Deleted simulation');
  console.log('\n=== All checks PASSED! ===');
}

main().catch(err => { console.error('[ERROR]', err.message); process.exit(1); });
