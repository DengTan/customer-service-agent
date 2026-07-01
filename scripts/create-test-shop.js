const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
});

async function main() {
  try {
    await client.connect();

    // 创建测试店铺
    const shopId = '11111111-1111-1111-1111-111111111111';
    console.log('创建测试店铺...');
    
    await client.query(`
      INSERT INTO shops (id, name, platform, shop_url, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `, [shopId, '测试旗舰店', 'taobao', 'https://shop123456.taobao.com', 'active']);
    
    console.log('✅ 店铺创建成功');

    // 将主 Bot 绑定到该店铺
    const botId = '00000000-0000-0000-0000-000000000001';
    console.log('\n绑定主 Bot 到店铺...');
    
    await client.query(`
      UPDATE bot_configs 
      SET platform_connection_id = $1, updated_at = NOW()
      WHERE id = $2
    `, [shopId, botId]);
    
    console.log('✅ Bot 绑定成功');

    // 验证结果
    console.log('\n验证绑定结果:');
    const result = await client.query(`
      SELECT b.name as bot_name, s.name as shop_name
      FROM bot_configs b
      LEFT JOIN shops s ON b.platform_connection_id = s.id
      WHERE b.id = $1
    `, [botId]);
    
    if (result.rows.length > 0) {
      console.log(`  Bot: ${result.rows[0].bot_name}`);
      console.log(`  绑定店铺: ${result.rows[0].shop_name}`);
    }

  } catch (e) {
    console.error('错误:', e.message);
  } finally {
    await client.end();
  }
}

main();
