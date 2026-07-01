const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
});

async function fix() {
  try {
    await client.connect();

    console.log('=== 修复 bot_configs 表 ===\n');
    
    // 1. 检查现有列
    const columns = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'bot_configs'
      ORDER BY ordinal_position
    `);
    console.log('现有列:');
    columns.rows.forEach(c => console.log(`  - ${c.column_name}: ${c.data_type}`));

    // 2. 添加 sub_agent_count 列
    console.log('\n添加 sub_agent_count 列...');
    try {
      await client.query(`
        ALTER TABLE bot_configs
        ADD COLUMN sub_agent_count integer DEFAULT 0
      `);
      console.log('✅ sub_agent_count 列已添加');
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log('⏭️  sub_agent_count 列已存在');
      } else {
        console.log('❌ 错误:', e.message);
      }
    }

    // 3. 更新 sub_agent_count
    console.log('\n更新子 Agent 计数...');
    await client.query(`
      UPDATE bot_configs bc
      SET sub_agent_count = (
        SELECT COUNT(*)::integer
        FROM bot_configs sub
        WHERE sub.parent_bot_id = bc.id AND sub.is_sub_agent = true
      )
      WHERE bc.is_sub_agent = false
    `);
    console.log('✅ 计数已更新');

    // 4. 验证
    console.log('\n验证结果:');
    const bots = await client.query(`
      SELECT name, is_sub_agent, sub_agent_count
      FROM bot_configs
      ORDER BY is_sub_agent DESC, name
    `);
    bots.rows.forEach(bot => {
      const marker = bot.is_sub_agent ? '  └── ' : '📌 ';
      console.log(`${marker}${bot.name} (count: ${bot.sub_agent_count})`);
    });

  } catch (e) {
    console.error('错误:', e.message);
  } finally {
    await client.end();
  }
}

fix();
