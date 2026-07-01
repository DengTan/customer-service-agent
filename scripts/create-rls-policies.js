const {Client} = require('pg');
const c = new Client({
  host: 'cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'tLk6MwE1qBEt55E57n',
  ssl: {rejectUnauthorized: false}
});

const sql = `
-- Create RLS policies for agent_assignment_config
ALTER TABLE agent_assignment_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users" ON agent_assignment_config
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create RLS policies for shop_agent_bindings
ALTER TABLE shop_agent_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users" ON shop_agent_bindings
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
`;

c.connect()
  .then(() => c.query(sql))
  .then(r => { 
    console.log('✅ RLS policies created successfully'); 
    console.log(JSON.stringify(r.rows, null, 2)); 
    c.end(); 
  })
  .catch(e => {
    console.error('Error:', e.message);
    c.end();
  });
