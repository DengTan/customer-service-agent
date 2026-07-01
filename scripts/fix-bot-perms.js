const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
});

async function fix() {
  try {
    await client.connect();

    console.log('=== 检查并修复 bot_configs 表权限 ===\n');
    
    // 检查现有权限
    const grants = await client.query(`
      SELECT grantee, privilege_type 
      FROM information_schema.table_privileges 
      WHERE table_name = 'bot_configs'
      ORDER BY grantee, privilege_type
    `);
    console.log('当前权限:');
    grants.rows.forEach(g => console.log(`  ${g.grantee}: ${g.privilege_type}`));

    // 检查 shops 表的权限作为参考
    console.log('\nshops 表的权限 (参考):');
    const shopGrants = await client.query(`
      SELECT grantee, privilege_type 
      FROM information_schema.table_privileges 
      WHERE table_name = 'shops'
      ORDER BY grantee, privilege_type
    `);
    shopGrants.rows.forEach(g => console.log(`  ${g.grantee}: ${g.privilege_type}`));

    // 修复权限 - 确保 anon 和 authenticated 角色有读取权限
    console.log('\n=== 修复 bot_configs 权限 ===');
    
    const permissions = [
      'GRANT SELECT, INSERT, UPDATE, DELETE ON bot_configs TO anon;',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON bot_configs TO authenticated;',
      'GRANT USAGE, SELECT ON SEQUENCE bot_configs_id_seq TO anon;',
      'GRANT USAGE, SELECT ON SEQUENCE bot_configs_id_seq TO authenticated;'
    ];

    for (const sql of permissions) {
      try {
        await client.query(sql);
        console.log(`✅ ${sql.split(' ON ')[1].split(' ')[0]}`);
      } catch (e) {
        if (e.message.includes('already granted')) {
          console.log(`⏭️  已存在`);
        } else {
          console.log(`❌ ${e.message.substring(0, 60)}`);
        }
      }
    }

    console.log('\n✅ 权限修复完成');

  } catch (e) {
    console.error('错误:', e.message);
  } finally {
    await client.end();
  }
}

fix();
