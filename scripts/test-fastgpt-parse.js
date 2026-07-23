const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

/**
 * 模拟修复后的 FastGPTClient.search() 行为
 * 验证 score 提取和 list 路径解析是否正确
 */
(async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', [
      'external_knowledge_base_url',
      'external_knowledge_api_key',
      'external_knowledge_dataset_id'
    ]);

  const settings = {};
  data.forEach(row => { settings[row.key] = row.value; });

  const baseUrl = settings.external_knowledge_base_url.replace(/\/$/, '');
  const apiKey = settings.external_knowledge_api_key;
  const datasetId = settings.external_knowledge_dataset_id;

  console.log('=== 模拟修复后的解析逻辑 ===\n');

  const response = await fetch(baseUrl + '/core/dataset/searchTest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      datasetId,
      text: '退货',
      limit: 5,
      similarity: 0.5,
      searchMode: 'embedding',
      usingReRank: false
    })
  });

  const json = await response.json();

  // 修复后的解析逻辑
  const extractScore = (raw) => {
    if (typeof raw === 'number') return raw;
    if (Array.isArray(raw)) {
      let best = 0;
      for (const s of raw) {
        if (s && typeof s === 'object' && typeof s.value === 'number') {
          if (s.value > best) best = s.value;
        }
      }
      return best;
    }
    return 0;
  };

  console.log('data.code:', json.code);
  console.log('data.data?.list 存在?', Array.isArray(json.data?.list));

  const list = json.data?.list;
  if (Array.isArray(list)) {
    console.log('结果数:', list.length);
    list.forEach((item, idx) => {
      const score = extractScore(item.score);
      console.log(`\n[${idx + 1}]`);
      console.log('  ID:', item.id);
      console.log('  q:', (item.q || '').substring(0, 100));
      console.log('  原始 score:', JSON.stringify(item.score));
      console.log('  提取 score:', score);
      console.log('  datasetId:', item.datasetId);
      console.log('  collectionId:', item.collectionId);
    });
  } else {
    console.log('无法解析 list！');
    console.log('data keys:', Object.keys(json.data || {}));
  }
})();