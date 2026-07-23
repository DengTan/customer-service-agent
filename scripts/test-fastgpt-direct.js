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
    .in('key', ['external_knowledge_base_url', 'external_knowledge_api_key', 'external_knowledge_dataset_id']);

  const settings = {};
  data.forEach(row => { settings[row.key] = row.value; });

  const baseUrl = settings.external_knowledge_base_url.replace(/\/$/, '');
  const apiKey = settings.external_knowledge_api_key;
  const datasetId = settings.external_knowledge_dataset_id;

  console.log('=== 测试 FastGPT API ===');
  console.log('URL:', baseUrl + '/core/dataset/searchTest');
  console.log('DatasetId:', datasetId);
  console.log('API Key:', apiKey.substring(0, 10) + '...');

  const response = await fetch(baseUrl + '/core/dataset/searchTest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      datasetId: datasetId,
      text: '退货',
      limit: 5,
      similarity: 0.5,
      searchMode: 'embedding',
      usingReRank: false
    })
  });

  console.log('HTTP Status:', response.status);

  const bodyText = await response.text();
  console.log('Response:', bodyText.substring(0, 1000));
})();