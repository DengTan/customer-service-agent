/**
 * 数据库诊断脚本 - 直接连接 Supabase PostgreSQL 检查 agent_assignment_stats 表
 */

const { Pool } = require('pg');

async function main() {
  const connectionString = 'postgresql://postgres.avmregjnnsmshwxrwjie:@aws-0-eu-central-1-0.pooler.supabase.com:6543/postgres';

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  try {
    console.log('Connecting to database...\n');

    const client = await pool.connect();
    console.log('Connected successfully!\n');

    // Check agent_assignment_stats table structure
    console.log('=== agent_assignment_stats table structure ===\n');
    const columnsResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'agent_assignment_stats'
      ORDER BY ordinal_position
    `);

    if (columnsResult.rows.length === 0) {
      console.log('Table agent_assignment_stats does NOT exist!');
    } else {
      columnsResult.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type}`);
      });
    }

    // Check data count
    console.log('\n=== agent_assignment_stats row count ===');
    const countResult = await client.query('SELECT COUNT(*) FROM agent_assignment_stats');
    console.log(`  ${countResult.rows[0].count} rows`);

    // Check users table agents
    console.log('\n=== users table (role=agent) ===');
    const agentsResult = await client.query("SELECT COUNT(*) FROM users WHERE role = 'agent' AND status = 'active'");
    console.log(`  ${agentsResult.rows[0].count} active agents`);

    // Check agent_sessions
    console.log('\n=== agent_sessions ===');
    const sessionsResult = await client.query('SELECT COUNT(*) FROM agent_sessions');
    console.log(`  ${sessionsResult.rows[0].count} records`);

    // Test the query from getAllAgentsStatus
    console.log('\n=== Testing getAllAgentsStatus query ===\n');

    const today = new Date().toISOString().split('T')[0];

    // Get agents
    const usersResult = await client.query(`
      SELECT id, name, email FROM users WHERE role = 'agent' AND status = 'active'
    `);
    console.log(`Agents found: ${usersResult.rows.length}`);
    if (usersResult.rows.length > 0) {
      usersResult.rows.forEach(u => console.log(`  - ${u.name} (${u.email})`));
    }

    if (usersResult.rows.length > 0) {
      const userIds = usersResult.rows.map(u => u.id);
      
      // Get sessions
      const sessions = await client.query(`
        SELECT user_id, status, last_active_at, current_conversation_id
        FROM agent_sessions
        WHERE user_id = ANY($1)
        ORDER BY last_active_at DESC
      `, [userIds]);
      console.log(`Sessions found: ${sessions.rows.length}`);

      // Get stats
      const stats = await client.query(`
        SELECT user_id, assigned_count, active_conversations, completed_count
        FROM agent_assignment_stats
        WHERE date = $1 AND user_id = ANY($2)
      `, [today, userIds]);
      console.log(`Stats found: ${stats.rows.length}`);
    }

    client.release();
    console.log('\nDone!');

  } catch (error) {
    console.error('Error:', error.message);
    if (error.code) console.error('Code:', error.code);
  } finally {
    await pool.end();
  }
}

main();
