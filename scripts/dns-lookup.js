const https = require('https');
const dns = require('dns');

// 检查两个域名的 IP
async function resolveHost(hostname) {
  return new Promise((resolve) => {
    dns.lookup(hostname, (err, address) => {
      if (err) resolve({ hostname, error: err.message });
      else resolve({ hostname, address });
    });
  });
}

async function check() {
  console.log('=== DNS 解析检查 ===\n');

  const hosts = [
    'br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com',
    'cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com'
  ];

  for (const host of hosts) {
    const result = await resolveHost(host);
    console.log(`${host}`);
    console.log(`  IP: ${result.address || result.error}`);
  }
}

check();
