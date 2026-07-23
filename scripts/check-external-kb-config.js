const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data, error } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', [
      'external_knowledge_enabled',
      'external_knowledge_provider',
      'external_knowledge_base_url',
      'external_knowledge_api_key',
      'external_knowledge_dataset_id',
      'llm_provider_id',
      'ai_model'
    ]);

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  console.log('=== 外部知识库配置 ===');
  const settings = {};
  data.forEach(row => {
    settings[row.key] = row.value;
  });

  console.log('external_knowledge_enabled:', settings.external_knowledge_enabled);
  console.log('external_knowledge_provider:', settings.external_knowledge_provider);
  console.log('external_knowledge_base_url:', settings.external_knowledge_base_url);
  console.log('external_knowledge_api_key:', settings.external_knowledge_api_key ? '***已配置***' : '(未配置)');
  console.log('external_knowledge_dataset_id:', settings.external_knowledge_dataset_id);

  console.log('\n=== LLM 配置 ===');
  console.log('llm_provider_id:', settings.llm_provider_id);
  console.log('ai_model:', settings.ai_model);
})();