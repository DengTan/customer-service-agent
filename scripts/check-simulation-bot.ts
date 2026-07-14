// Quick test script to check simulation_conversations data
const https = require('https');

// Directly use the service role key
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2bXJlZ2pubnNtc2h3eHJ3amllIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjUwOTM3MiwiZXhwIjoyMDk4MDg1MzcyfQ.Wd8gaFZ10f8rq68DeKs263SC1-hlTO4el-MjtqTWQD0';

const supabaseUrl = 'https://avmregjnnsmshwxrwjie.supabase.co';
const url = new URL(supabaseUrl + '/rest/v1/simulation_conversations?select=id,title,bot_id,bot_name,scenario_name&limit=10');

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
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      const parsed = JSON.parse(data);
      console.log('\nSimulation Conversations:');
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (e) => console.error('Request error:', e));
req.end();
