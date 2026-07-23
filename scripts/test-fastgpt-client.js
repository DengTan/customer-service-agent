// 直接测试 FastGPTClient 类来验证修复
const { FastGPTClient, loadExternalKnowledgeConfig } = require('./src/server/services/fastgpt-client.ts');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

(async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // 读取配置
  const { data } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', [
      'external_knowledge_enabled',
      'external_knowledge_base_url',
      'external_knowledge_api_key',
      'external_knowledge_dataset_id'
    ]);

  const settings = {};
  data.forEach(row => { settings[row.key] = row.value; });

  const config = {
    enabled: settings.external_knowledge_enabled === 'true',
    provider: 'fastgpt',
    baseUrl: settings.external_knowledge_base_url,
    apiKey: settings.external_knowledge_api_key,
    datasetId: settings.external_knowledge_dataset_id
  };

  console.log('=== 测试 FastGPTClient 类（修复后）===');
  console.log('Config:', {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey ? '***' : 'MISSING',
    datasetId: config.datasetId
  });

  const client = new FastGPTClient(config);
  console.log('\n=== 搜索 "退货" ===');

  try {
    const response = await client.search('退货', 5, 0.5);
    console.log('返回结果数:', response.results.length);
    console.log('Total:', response.total);
    console.log('QueryTime:', response.queryTime + 'ms');

    if (response.results.length > 0) {
      console.log('\n=== 第一个结果 ===');
      const r = response.results[0];
      console.log('ID:', r.id);
      console.log('Content:', r.content.substring(0, 100));
      console.log('Score:', r.score);
      console.log('DatasetId:', r.datasetId);
      console.log('DocumentId:', r.documentId);
      console.log('Metadata:', JSON.stringify(r.metadata));
    }
  } catch (err) {
    console.error('搜索失败:', err.message);
  }
})();