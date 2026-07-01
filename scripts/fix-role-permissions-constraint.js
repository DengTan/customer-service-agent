/**
 * 修复 role_permissions 唯一约束问题
 * 执行方式: node scripts/fix-role-permissions-constraint.js
 */

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

  await client.connect();
  console.log('Connected to database');

  // Step 1: Check current constraints
  const constraints = await client.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'role_permissions'::regclass
    AND contype = 'u'
  `);
  console.log('Current unique constraints:', constraints.rows.length ? constraints.rows.map(r => r.conname) : 'none');

  // Step 2: Delete duplicate rows
  console.log('\nDeleting duplicate permission rows...');
  const deleteResult = await client.query(`
    DELETE FROM role_permissions a
    USING role_permissions b
    WHERE a.ctid < b.ctid
      AND a.role = b.role
      AND a.resource = b.resource
      AND a.action = b.action
  `);
  console.log('Deleted', deleteResult.rowCount, 'duplicate rows');

  // Step 3: Add unique constraint
  console.log('\nAdding unique constraint...');
  try {
    await client.query(`
      ALTER TABLE role_permissions
        ADD CONSTRAINT role_permissions_role_resource_action_unique
        UNIQUE (role, resource, action)
    `);
    console.log('Constraint added successfully!');
  } catch (err) {
    if (err.code === '42P07') {
      console.log('Constraint already exists (OK)');
    } else {
      throw err;
    }
  }

  // Step 4: Verify
  const verify = await client.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'role_permissions'::regclass
    AND contype = 'u'
  `);
  console.log('\nFinal unique constraints:', verify.rows.map(r => r.conname));

  // Step 5: Show current row count
  const count = await client.query('SELECT COUNT(*) FROM role_permissions');
  console.log('Current rows in role_permissions:', count.rows[0].count);

  await client.end();
  console.log('\nDone!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
