const https = require('https');

const SUPABASE_URL = 'https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJhbm9uIn0.Ud02Pbuv5gdh_BhUx0cSmUSsh9fLtxp3VXqRS65AA8E';

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
  console.log('=== 验证数据 ===\n');

  console.log('--- Anon Key ---');
  const shopAnon = await query('shops', ANON_KEY);
  console.log('shops:', JSON.stringify(shopAnon.data, null, 2));
}

check().catch(e => console.error('错误:', e.message));
