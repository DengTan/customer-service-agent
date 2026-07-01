const https = require('https');

const SUPABASE_URL = 'https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJhbm9uIn0.Ud02Pbuv5gdh_BhUx0cSmUSsh9fLtxp3VXqRS65AA8E';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.o_YsuAqvnACfooDVkx79nFI-LHiDP10HApRYCuq9Kl8';

function query(table, key) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/rest/v1/${table}?select=*`, SUPABASE_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function check() {
  console.log('=== 对比测试 Anon Key vs Service Key ===\n');

  console.log('--- Anon Key ---');
  const botAnon = await query('bot_configs', ANON_KEY);
  console.log('bot_configs:', botAnon.data.length, '条');
  const shopAnon = await query('shops', ANON_KEY);
  console.log('shops:', shopAnon.data.length, '条');

  console.log('\n--- Service Key ---');
  const botSvc = await query('bot_configs', SERVICE_KEY);
  console.log('bot_configs:', botSvc.data.length, '条');
  const shopSvc = await query('shops', SERVICE_KEY);
  console.log('shops:', shopSvc.data.length, '条');

  if (shopSvc.data.length > 0) {
    console.log('\nshops 数据:', JSON.stringify(shopSvc.data, null, 2));
  }
}

check().catch(e => console.error('错误:', e.message));
