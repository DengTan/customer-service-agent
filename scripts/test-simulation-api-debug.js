/**
 * Test simulation API - print ALL SSE events for debugging
 */

const http = require('http');

async function login() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      email: 'admin@smartassist.com',
      password: 'Admin123456'
    });
    
    const req = http.request({
      hostname: 'localhost', port: 5000, path: '/api/auth/login',
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(res.headers['set-cookie']));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function createSimulation(cookies) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ name: 'Test', scenario_id: 'general' });
    const req = http.request({
      hostname: 'localhost', port: 5000, path: '/api/simulations',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookies.map(c => c.split(';')[0]).join('; ') }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).conversation?.id); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function testMessage(cookies, id) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ content: '你好' });
    const req = http.request({
      hostname: 'localhost', port: 5000, path: '/api/simulations/' + id + '/messages',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookies.map(c => c.split(';')[0]).join('; ') }
    }, (res) => {
      console.log('\n=== SSE Events ===');
      res.on('data', (chunk) => {
        const text = chunk.toString();
        console.log(text);
      });
      res.on('end', () => {
        console.log('=== End of Stream ===');
        resolve();
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('Testing Sensenova - SSE Debug...\n');
  const cookies = await login();
  console.log('Logged in');
  const id = await createSimulation(cookies);
  if (id) {
    console.log('Simulation:', id);
    await testMessage(cookies, id);
  }
}
main().catch(console.error);
