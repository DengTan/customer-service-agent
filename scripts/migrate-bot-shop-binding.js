const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
});

async function migrate() {
  console.log('开始迁移 bot_configs 表...\n');

  try {
    await client.connect();
    console.log('已连接数据库');

    // 1. 添加 platform_connection_id 列 (类型与 shops.id 一致)
    console.log('\n步骤 1: 添加 platform_connection_id 列...');
    try {
      await client.query(`
        ALTER TABLE bot_configs
        ADD COLUMN platform_connection_id character varying
      `);
      console.log('  成功添加 platform_connection_id 列');
    } catch (e) {
      if (e.code === '42701') {
        console.log('  列已存在，跳过');
      } else {
        throw e;
      }
    }

    // 2. 检查现有数据
    console.log('\n步骤 2: 检查重复绑定...');
    const existingBindings = await client.query(`
      SELECT platform_connection_id, COUNT(*) as bot_count
      FROM bot_configs
      WHERE platform_connection_id IS NOT NULL
      GROUP BY platform_connection_id
      HAVING COUNT(*) > 1
    `);

    if (existingBindings.rows.length > 0) {
      console.log('  发现重复绑定的店铺，需要清理...');
      for (const row of existingBindings.rows) {
        const shopId = row.platform_connection_id;
        const toKeep = await client.query(`
          SELECT id FROM bot_configs
          WHERE platform_connection_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `, [shopId]);
        if (toKeep.rows.length > 0) {
          const keepId = toKeep.rows[0].id;
          await client.query(`
            UPDATE bot_configs
            SET platform_connection_id = NULL
            WHERE platform_connection_id = $1 AND id != $2
          `, [shopId, keepId]);
          console.log(`  店铺 ${shopId}: 保留 Bot ${keepId}`);
        }
      }
    } else {
      console.log('  无重复绑定');
    }

    // 3. 添加唯一约束
    console.log('\n步骤 3: 添加唯一约束...');
    try {
      await client.query(`
        CREATE UNIQUE INDEX bot_configs_shop_id_unique
        ON bot_configs((platform_connection_id))
        WHERE platform_connection_id IS NOT NULL
      `);
      console.log('  成功添加唯一约束');
    } catch (e) {
      if (e.code === '42P07') {
        console.log('  约束已存在，跳过');
      } else if (e.code === '23505') {
        console.log('  无法创建约束，存在重复数据');
      } else {
        throw e;
      }
    }

    console.log('\n迁移完成!');

    // 显示最终表结构
    console.log('\n最终 bot_configs 表结构:');
    const columns = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'bot_configs'
      ORDER BY ordinal_position
    `);
    columns.rows.forEach(c => console.log('  ' + c.column_name + ': ' + c.data_type));

  } catch (e) {
    console.error('\n迁移失败:', e.message);
  } finally {
    await client.end();
  }
}

migrate();
