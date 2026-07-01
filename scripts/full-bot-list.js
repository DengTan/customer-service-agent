const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
});

async function check() {
  try {
    await client.connect();

    console.log('=== 完整 Bot 列表 ===\n');
    
    const bots = await client.query(`
      SELECT id, name, is_sub_agent, parent_bot_id, sub_agent_count
      FROM bot_configs
      ORDER BY is_sub_agent DESC, created_at ASC
    `);
    
    console.log(`共 ${bots.rows.length} 个 Bot:\n`);
    bots.rows.forEach(bot => {
      const marker = bot.is_sub_agent ? '  └── 子Agent' : '📌 主Bot';
      console.log(`${marker}: ${bot.name}`);
      console.log(`       ID: ${bot.id}`);
      console.log(`       parent_bot_id: ${bot.parent_bot_id}`);
      console.log(`       sub_agent_count: ${bot.sub_agent_count}`);
      console.log('');
    });

    // 统计
    const mainBots = bots.rows.filter(b => !b.is_sub_agent);
    const subBots = bots.rows.filter(b => b.is_sub_agent);
    console.log(`统计: ${mainBots.length} 个主Bot, ${subBots.length} 个子Bot`);

  } catch (e) {
    console.error('错误:', e.message);
  } finally {
    await client.end();
  }
}

check();
