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
    console.log('Connected');

    // 1. Check existing constraints on role_permissions
    const { rows: constraints } = await client.query(
      "SELECT conname FROM pg_constraint WHERE conrelid = 'role_permissions'::regclass"
    );
    console.log('Existing constraints:', constraints.map(r => r.conname));

    // 2. Check if unique constraint exists
    const hasUnique = constraints.some(r => r.conname.includes('unique') || r.conname.includes('role_resource'));
    console.log('Has unique constraint:', hasUnique);

    // 3. If no unique constraint, add it first
    if (!hasUnique) {
      console.log('Adding unique constraint...');
      // Delete duplicates first
      await client.query(`
        DELETE FROM role_permissions a
        USING role_permissions b
        WHERE a.ctid < b.ctid
          AND a.role = b.role
          AND a.resource = b.resource
          AND a.action = b.action
      `);
      // Add constraint
      await client.query(`
        ALTER TABLE role_permissions
        ADD CONSTRAINT role_permissions_role_resource_action_unique
        UNIQUE (role, resource, action)
      `);
      console.log('Unique constraint added');
    }

    // 4. Count existing rows
    const { rows: countRows } = await client.query('SELECT COUNT(*) as cnt FROM role_permissions');
    console.log('Existing rows:', countRows[0].cnt);

    // 5. Execute seed SQL
    const fs = require('fs');
    const path = require('path');
    const seedFile = path.join(__dirname, '../supabase/migrations/20260701_permission_seed.sql');
    const sql = fs.readFileSync(seedFile, 'utf8');
    await client.query(sql);
    console.log('Seed SQL executed');

    // 6. Verify row count after
    const { rows: finalRows } = await client.query('SELECT COUNT(*) as cnt FROM role_permissions');
    console.log('Final row count:', finalRows[0].cnt);

    // 7. Show sample data
    const { rows: samples } = await client.query(
      "SELECT role, resource, action, allowed FROM role_permissions LIMIT 5"
    );
    console.log('Sample rows:', JSON.stringify(samples, null, 2));

  } catch (error) {
    console.error('Error:', error.message);
    if (error.code) console.error('Code:', error.code);
    if (error.detail) console.error('Detail:', error.detail);
  } finally {
    await client.end();
  }
}

main();
