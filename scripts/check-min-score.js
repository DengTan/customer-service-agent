const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data } = await supabase
    .from('settings')
    .select('key, value')
    .eq('key', 'knowledge_min_score');

  console.log('=== knowledge_min_score 设置 ===');
  if (data.length === 0) {
    console.log('(未设置，使用默认值 0.75)');
  } else {
    console.log('当前值:', data[0].value);
  }
})();