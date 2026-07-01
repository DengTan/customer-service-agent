/**
 * 查找正确的 PostgreSQL 直连地址
 */

const { Client } = require('pg');

async function findPostgresConnection() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║              查找正确的 PostgreSQL 连接                     ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const possibleHosts = [
    'br-alive-kea-4152cf8a-pg.aidap-global.cn-beijing.volces.com',
    'br-alive-kea-4152cf8a-pg2.aidap-global.cn-beijing.volces.com',
    'br-alive-kea-4152cf8a.db.aidap-global.cn-beijing.volces.com',
    'db.br-alive-kea-4152cf8a.aidap-global.cn-beijing.volces.com',
    'cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com',
  ];

  for (const host of possibleHosts) {
    process.stdout.write(`尝试 ${host}... `);
    try {
      const testClient = new Client({
        host,
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        password: 'tLk6MwE1qBEt55E57n',
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000
      });
      
      await testClient.connect();
      const result = await testClient.query('SELECT count(*) FROM users');
      const size = await testClient.query('SELECT pg_size_pretty(pg_database_size(current_database())) as size');
      
      console.log(`✓ 连接成功!`);
      console.log(`   users: ${result.rows[0].count} 条`);
      console.log(`   数据库大小: ${size.rows[0].size}\n`);
      
      await testClient.end();
      return host;
    } catch (e) {
      console.log(`✗ ${e.message.split('\n')[0]}\n`);
    }
  }

  console.log('【结论】');
  console.log('  无法通过密码 tLk6MwE1qBEt55E57n 连接其他地址');
  console.log('  建议联系 Coze 平台技术支持获取正确的 PostgreSQL 直连地址');
}

findPostgresConnection();
