/**
 * 数据库诊断脚本 - 直接连接 Supabase PostgreSQL 检查 agent_assignment_stats 表
 * 运行方式: npx ts-node scripts/db-connect.ts
 */

import pg from 'pg';

const { Pool } = pg;

async function main() {
  // Supabase Connection Pooler 连接字符串
  const connectionString = 'postgresql://postgres.avmregjnnsmshwxrwjie:@aws-0-eu-central-1-0.pooler.supabase.com:6543/postgres';

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  try {
    console.log('正在连接数据库...\n');

    const client = await pool.connect();
    console.log('✅ 数据库连接成功！\n');

    // 1. 检查 agent_assignment_stats 表是否存在及结构
    console.log('📋 检查 agent_assignment_stats 表结构:\n');
    const columnsResult = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'agent_assignment_stats'
      ORDER BY ordinal_position
    `);

    if (columnsResult.rows.length === 0) {
      console.log('❌ 表 agent_assignment_stats 不存在！');
    } else {
      columnsResult.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      });
    }

    // 2. 检查是否有任何数据
    console.log('\n📊 agent_assignment_stats 数据行数:');
    const countResult = await client.query('SELECT COUNT(*) FROM agent_assignment_stats');
    console.log(`  ${countResult.rows[0].count} 行`);

    // 3. 检查 users 表中的坐席数量
    console.log('\n📊 users 表中 agent 角色数量:');
    const agentsResult = await client.query("SELECT COUNT(*) FROM users WHERE role = 'agent' AND status = 'active'");
    console.log(`  ${agentsResult.rows[0].count} 个坐席`);

    // 4. 检查 agent_sessions 表
    console.log('\n📊 agent_sessions 表数据:');
    const sessionsResult = await client.query('SELECT COUNT(*) FROM agent_sessions');
    console.log(`  ${sessionsResult.rows[0].count} 条会话记录`);

    // 5. 直接测试 API 逻辑中的查询
    console.log('\n🔍 测试 getAllAgentsStatus 查询逻辑:\n');

    const today = new Date().toISOString().split('T')[0];
    console.log(`  今天的日期: ${today}`);

    // Get all agents
    const usersResult = await client.query(`
      SELECT id, name, email FROM users WHERE role = 'agent' AND status = 'active'
    `);
    console.log(`  查询到的坐席数: ${usersResult.rows.length}`);
    if (usersResult.rows.length > 0) {
      console.log('  坐席列表:');
      usersResult.rows.forEach(u => console.log(`    - ${u.name} (${u.email})`));
    }

    // Get agent sessions
    if (usersResult.rows.length > 0) {
      const userIds = usersResult.rows.map(u => `'${u.id}'`).join(',');
      const sessionsResult2 = await client.query(`
        SELECT user_id, status, last_active_at, current_conversation_id
        FROM agent_sessions
        WHERE user_id IN (${userIds})
        ORDER BY last_active_at DESC
      `);
      console.log(`  查询到的会话数: ${sessionsResult2.rows.length}`);

      // Deduplicate
      const dedupMap = new Map();
      for (const s of sessionsResult2.rows) {
        if (!dedupMap.has(s.user_id)) {
          dedupMap.set(s.user_id, s);
        }
      }
      console.log(`  去重后会话数: ${dedupMap.size}`);
    }

    // Get today's stats
    if (usersResult.rows.length > 0) {
      const userIds = usersResult.rows.map(u => `'${u.id}'`).join(',');
      const statsResult = await client.query(`
        SELECT user_id, assigned_count, active_conversations, completed_count, last_assigned_at
        FROM agent_assignment_stats
        WHERE date = '${today}' AND user_id IN (${userIds})
      `);
      console.log(`  今日统计数据行数: ${statsResult.rows.length}`);
      if (statsResult.rows.length > 0) {
        statsResult.rows.forEach(s => {
          console.log(`    user_id: ${s.user_id}, assigned: ${s.assigned_count}, active: ${s.active_conversations}`);
        });
      }
    }

    client.release();
    console.log('\n✅ 诊断完成！');

  } catch (error: any) {
    console.error('❌ 数据库操作失败:');
    console.error(`   错误代码: ${error.code}`);
    console.error(`   错误消息: ${error.message}`);
    console.error(`   错误详情: ${error.detail || 'N/A'}`);

    if (error.code === '42P01') {
      console.log('\n💡 表不存在，请确保迁移脚本已执行！');
    }
  } finally {
    await pool.end();
  }
}

main();
