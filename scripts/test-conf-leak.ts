/**
 * Phase 1 Feedback Loop: Test if CONF tags leak through the SSE stream.
 * Accumulates ALL content chunks before checking for CONF.
 * Run: npx tsx scripts/test-conf-leak.ts
 * Exit code: 0 = PASS, 1 = FAIL, 2 = ERROR
 */
import http from 'http';

const PORT = 5000;

async function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: PORT, ...options }, (res) => {
      const cookies: string[] = [];
      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        for (const c of setCookie) cookies.push(c.split(';')[0]);
      }
      const rawParts: Buffer[] = [];
      res.on('data', (chunk: Buffer) => rawParts.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(rawParts).toString('utf8'), cookies }));
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Login
  const loginRes = await httpRequest({
    path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json' }
  }, { email: 'admin@smartassist.com', password: 'Admin123456' });
  const cookies = loginRes.cookies;
  if (loginRes.status !== 200 || cookies.length === 0) {
    console.error('FAIL: Login failed'); process.exit(2);
  }

  // Get conversation list
  const convsRes = await httpRequest({
    path: '/api/conversations?limit=10', method: 'GET',
    headers: { 'Cookie': cookies.join('; ') }
  });
  let conversations: any[] = [];
  try {
    const parsed = JSON.parse(convsRes.body);
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed)) conversations = parsed;
      else if (Array.isArray(parsed.conversations)) conversations = parsed.conversations;
    }
  } catch {}
  if (conversations.length === 0) { console.error('FAIL: No conversations'); process.exit(2); }

  // Find an active conversation
  const target = conversations.find(c => c.status === 'active') || conversations[0];
  const isSim = String(target.id).startsWith('sim-');
  const msgPath = isSim ? `/api/simulations/${target.id}/messages` : `/api/conversations/${target.id}/messages`;
  
  console.log(`Target: ${target.id} (${target.title || 'no title'}, ${target.status})`);
  console.log(`Path: ${msgPath}`);

  // Send test message
  const TEST = '请问退货政策是什么？';
  console.log(`\n→ POST ${msgPath}`);
  
  const sseRes = await new Promise<any>(async (resolve, reject) => {
    const postData = JSON.stringify({ content: TEST });
    const timer = setTimeout(() => reject(new Error('SSE timeout (>90s)')), 90000);
    const req = http.request({
      hostname: 'localhost', port: PORT, path: msgPath, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies.join('; '),
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      const rawParts: Buffer[] = [];
      res.on('data', (chunk: Buffer) => rawParts.push(chunk));
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, body: Buffer.concat(rawParts).toString('utf8') }); });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.write(postData);
    req.end();
  });

  console.log(`  ← Status: ${sseRes.status}, body: ${sseRes.body.length} bytes`);

  // Parse SSE — accumulate ALL content chunks first, then check
  const rawLines: string[] = [];
  const contentParts: string[] = [];
  
  for (const line of sseRes.body.split('\n')) {
    rawLines.push(line);
    if (!line.startsWith('data: ')) continue;
    try {
      const json = JSON.parse(line.slice(6));
      if (json.content) {
        contentParts.push(json.content);
      }
    } catch { /* skip */ }
  }

  // Check EACH individual chunk for CONF patterns
  const hwConfPerChunk: string[] = [];
  const fwConfPerChunk: string[] = [];
  for (const part of contentParts) {
    const hw = part.match(/\[CONF:[0-9]*\.?[0-9]+\]/g) || [];
    const fw = part.match(/【CONF:[0-9]*\.?[0-9]+】/g) || [];
    hwConfPerChunk.push(...hw);
    fwConfPerChunk.push(...fw);
  }

  // Check FULL accumulated content
  const fullContent = contentParts.join('');
  const hwConfFull = fullContent.match(/\[CONF:[0-9]*\.?[0-9]+\]/g) || [];
  const fwConfFull = fullContent.match(/【CONF:[0-9]*\.?[0-9]+】/g) || [];
  
  console.log(`\n--- SSE Content (${fullContent.length} chars, ${contentParts.length} chunks) ---`);
  console.log(fullContent.slice(-400));
  console.log('--- End ---\n');

  // Print last few SSE lines to see CONF split
  console.log('Last 5 SSE lines:');
  rawLines.slice(-8).forEach((l, i) => {
    if (l.trim()) console.log(`  [${rawLines.length - 8 + i}]: ${l.slice(0, 200)}`);
  });

  console.log(`\nPer-chunk CONF check: ${hwConfPerChunk.length + fwConfPerChunk.length} found`);
  console.log(`Accumulated CONF check: ${hwConfFull.length + fwConfFull.length} found`);
  
  if (hwConfFull.length > 0) console.log(`  Half-width: ${JSON.stringify(hwConfFull)}`);
  if (fwConfFull.length > 0) console.log(`  Full-width: ${JSON.stringify(fwConfFull)}`);

  const allConf = [...hwConfPerChunk, ...fwConfPerChunk, ...hwConfFull, ...fwConfFull];
  if (allConf.length > 0) {
    console.error(`\n❌ FAIL: CONF tag(s) leaked:`);
    allConf.forEach(c => console.error(`  "${c}"`));
    console.error(`\nPer-chunk detection: ${hwConfPerChunk.length + fwConfPerChunk.length}`);
    console.error(`Accumulated detection: ${hwConfFull.length + fwConfFull.length}`);
    process.exit(1);
  }
  
  console.log('\n✓ PASS: No CONF tags in SSE stream');
  process.exit(0);
}

main().catch((err) => {
  if (err.code === 'ECONNREFUSED') { console.error('ERROR: Dev server not running'); process.exit(2); }
  console.error('ERROR:', err.message); process.exit(2);
});
