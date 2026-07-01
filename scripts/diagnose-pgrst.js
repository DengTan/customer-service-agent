const { Client } = require('pg');

const PG_CONFIG = {
  host: 'cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'tLk6MwE1qBEt55E57n',
  ssl: { rejectUnauthorized: false }
};

async function main() {
  const client = new Client(PG_CONFIG);
  
  try {
    await client.connect();
    
    // 检查 llm_providers 表是否存在
    console.log('检查 llm_providers 表...');
    const tableCheck = await client.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_name = 'llm_providers'
    `);
    console.log('表信息:', tableCheck.rows);
    
    // 检查表结构
    console.log('\n表结构:');
    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'llm_providers'
      ORDER BY ordinal_position
    `);
    columns.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
    // 检查 RLS 策略
    console.log('\nRLS 策略:');
    const rls = await client.query(`
      SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
      FROM pg_policies
      WHERE tablename = 'llm_providers'
    `);
    console.log('RLS 策略数量:', rls.rows.length);
    rls.rows.forEach(p => {
      console.log(`  ${p.policyname}: ${p.cmd} (roles: ${p.roles})`);
    });
    
    // 检查表的 schema 暴露
    console.log('\n检查 tables 暴露:');
    const tables = await client.query(`
      SELECT * FROM pg_tables WHERE tablename = 'llm_providers'
    `);
    console.log('PostgreSQL 表:', tables.rows);
    
    // 检查 extensions
    console.log('\n已安装扩展:');
    const exts = await client.query(`SELECT extname, extversion FROM pg_extension`);
    exts.rows.forEach(e => console.log(`  ${e.extname}: ${e.extversion}`));
    
    console.log('\n✅ 诊断完成');
    
  } catch (err) {
    console.error('错误:', err.message);
  } finally {
    await client.end();
  }
}

main();
