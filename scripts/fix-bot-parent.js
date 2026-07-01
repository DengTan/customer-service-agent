const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
});

async function fix() {
  try {
    await client.connect();

    const oldMainBotId = '8f79e593-1d28-45dc-812c-d339d8dfa098';
    const newMainBotId = '00000000-0000-0000-0000-000000000001';

    console.log('=== 修复子 Bot 的 parent_bot_id ===\n');

    // 把旧 parent_bot_id 替换为新主 Bot ID
    const result = await client.query(`
      UPDATE bot_configs 
      SET parent_bot_id = $1
      WHERE parent_bot_id = $2 AND is_sub_agent = true
      RETURNING id, name
    `, [newMainBotId, oldMainBotId]);

    console.log(`更新了 ${result.rows.length} 个子 Bot:`);
    result.rows.forEach(row => {
      console.log(`  - ${row.name}`);
    });

    // 验证
    console.log('\n=== 验证 ===');
    const all = await client.query(`
      SELECT id, name, is_sub_agent, parent_bot_id
      FROM bot_configs 
      ORDER BY is_sub_agent DESC, name
    `);
    
    all.rows.forEach(row => {
      const mark = row.is_sub_agent ? '  └── ' : '📌 ';
      console.log(`${mark}${row.name}`);
      if (row.is_sub_agent) {
        console.log(`       → parent: ${row.parent_bot_id}`);
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
