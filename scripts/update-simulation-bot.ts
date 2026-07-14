// Update simulation conversations with bot info
const https = require('https');

const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2bXJlZ2pubnNtc2h3eHJ3amllIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjUwOTM3MiwiZXhwIjoyMDk4MDg1MzcyfQ.Wd8gaFZ10f8rq68DeKs263SC1-hlTO4el-MjtqTWQD0';

async function query(table, params = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://avmregjnnsmshwxrwjie.supabase.co/rest/v1/${table}?${params}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + serviceKey,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
}

async function update(table, id, updates) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://avmregjnnsmshwxrwjie.supabase.co/rest/v1/${table}?id=eq.${id}`);
    const body = JSON.stringify(updates);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'PATCH',
      headers: {
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getBots() {
  return query('bot_configs?select=id,name&status=eq.active&limit=5');
}

async function main() {
  console.log('Fetching bots...');
  const bots = await getBots();
  console.log('Bots:', JSON.stringify(bots, null, 2));
  
  if (bots.length === 0) {
    console.log('No active bots found');
    return;
  }
  
  const defaultBot = bots[0];
  console.log(`\nUpdating conversations with bot: ${defaultBot.name} (${defaultBot.id})`);
  
  console.log('\nFetching simulation conversations...');
  const conversations = await query('simulation_conversations?select=id,title,bot_id,bot_name&order=created_at.desc&limit=20');
  console.log(`Found ${conversations.length} conversations`);
  
  // Update all conversations that have null bot_id
  let updated = 0;
  for (const conv of conversations) {
    if (!conv.bot_id) {
      await update('simulation_conversations', conv.id, {
        bot_id: defaultBot.id,
        bot_name: defaultBot.name
      });
      updated++;
      console.log(`Updated: ${conv.title}`);
    }
  }
  
  console.log(`\nTotal updated: ${updated}`);
  
  // Verify
  const afterUpdate = await query('simulation_conversations?select=id,title,bot_id,bot_name&order=created_at.desc&limit=5');
  console.log('\nAfter update:');
  console.log(JSON.stringify(afterUpdate, null, 2));
}

main().catch(console.error);
