const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
});

async function fix() {
  try {
    await client.connect();

    console.log('=== 修复 Bot 层级关系 ===\n');

    const mainBotId = '00000000-0000-0000-0000-000000000001';

    // 把三个子 Bot 的 parent_bot_id 改为主 Bot
    const result = await client.query(`
      UPDATE bot_configs 
      SET parent_bot_id = $1
      WHERE is_sub_agent = true AND parent_bot_id != $1
      RETURNING id, name, parent_bot_id
    `, [mainBotId]);

    console.log(`更新了 ${result.rows.length} 个子 Bot:`);
    result.rows.forEach(row => {
      console.log(`  - ${row.name} → parent: ${row.parent_bot_id}`);
    });

    // 删除中间层 "通用客服Bot"（如果没人引用）
    const generalBotId = '00000000-0000-0000-0000-000000000002';
    
    // 先检查是否被引用
    const refs = await client.query(`
      SELECT COUNT(*) as cnt FROM bot_configs WHERE parent_bot_id = $1
    `, [generalBotId]);
    
    console.log(`\n通用客服Bot 被引用数: ${refs.rows[0].cnt}`);
    
    if (refs.rows[0].cnt === '0') {
      const del = await client.query(`
        DELETE FROM bot_configs WHERE id = $1
      `, [generalBotId]);
      console.log('✅ 已删除空的通用客服Bot');
    } else {
      console.log('(保留通用客服Bot)');
    }

    console.log('\n=== 验证 ===');
    const all = await client.query(`
      SELECT id, name, is_sub_agent, parent_bot_id, status
      FROM bot_configs 
      ORDER BY is_sub_agent, name
    `);
    
    all.rows.forEach((row, i) => {
      const indent = row.is_sub_agent ? '  └── ' : '';
      console.log(`${indent}${i + 1}. ${row.name} (${row.status})`);
      if (row.is_sub_agent) {
        console.log(`       parent: ${row.parent_bot_id}`);
      }
    });

    console.log('\n✅ 完成！请刷新页面。');

  } catch (e) {
    console.error('错误:', e.message);
  } finally {
    await client.end();
  }
}

fix();
