/**
 * 诊断脚本：验证知识库删除操作是否正确执行
 * 
 * 运行方式：node scripts/check-knowledge-delete.js
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ 缺少环境变量：SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkKnowledgeItems() {
  console.log('\n📊 知识库数据统计\n');
  console.log('='.repeat(60));

  // 1. 统计各状态的记录数
  const { count: total } = await supabase
    .from('knowledge_items')
    .select('*', { count: 'exact', head: true });

  const { count: active } = await supabase
    .from('knowledge_items')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');

  const { count: archived } = await supabase
    .from('knowledge_items')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'archived');

  const { count: deleted } = await supabase
    .from('knowledge_items')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'deleted');

  console.log(`总记录数: ${total}`);
  console.log(`  - active:   ${active || 0}`);
  console.log(`  - archived:  ${archived || 0}`);
  console.log(`  - deleted:  ${deleted || 0}`);
  console.log('='.repeat(60));

  // 2. 检查是否有记录但 status 字段异常
  const { data: nullStatus } = await supabase
    .from('knowledge_items')
    .select('id, name, status')
    .is('status', null)
    .limit(5);

  if (nullStatus && nullStatus.length > 0) {
    console.log('\n⚠️  发现 status 为 NULL 的记录:\n');
    nullStatus.forEach(item => {
      console.log(`  ID: ${item.id}`);
      console.log(`  Name: ${item.name}`);
      console.log(`  Status: ${item.status}`);
      console.log('---');
    });
  }

  // 3. 获取最近删除的记录（按 updated_at 排序）
  const { data: recentlyUpdated } = await supabase
    .from('knowledge_items')
    .select('id, name, status, updated_at, created_at')
    .in('status', ['deleted', 'archived'])
    .order('updated_at', { ascending: false })
    .limit(10);

  if (recentlyUpdated && recentlyUpdated.length > 0) {
    console.log('\n📋 最近修改的记录（deleted/archived 状态）:\n');
    recentlyUpdated.forEach(item => {
      const updatedDate = new Date(item.updated_at).toLocaleString('zh-CN');
      console.log(`  ${item.name}`);
      console.log(`    ID: ${item.id}`);
      console.log(`    Status: ${item.status}`);
      console.log(`    Updated: ${updatedDate}`);
      console.log('---');
    });
  }

  // 4. 测试：模拟删除一条记录再查询
  console.log('\n🔬 删除测试\n');
  console.log('='.repeat(60));

  // 获取一条 active 记录
  const { data: testItem } = await supabase
    .from('knowledge_items')
    .select('id, name, status')
    .eq('status', 'active')
    .limit(1)
    .single();

  if (!testItem) {
    console.log('没有可测试的 active 记录，跳过删除测试');
    console.log('\n✅ 诊断完成');
    return;
  }

  console.log(`测试记录: ${testItem.name}`);
  console.log(`ID: ${testItem.id}`);

  // 执行软删除
  const { error: deleteError } = await supabase
    .from('knowledge_items')
    .update({ status: 'deleted', updated_at: new Date().toISOString() })
    .eq('id', testItem.id);

  if (deleteError) {
    console.log(`\n❌ 删除失败: ${deleteError.message}`);
    return;
  }

  console.log('\n✓ 删除命令已执行');

  // 立即查询（模拟前端行为）
  const { data: afterDelete } = await supabase
    .from('knowledge_items')
    .select('id, name, status')
    .eq('id', testItem.id)
    .single();

  console.log(`\n删除后立即查询结果:`);
  console.log(`  Status: ${afterDelete?.status}`);
  console.log(`  Name: ${afterDelete?.name}`);

  if (afterDelete?.status === 'deleted') {
    console.log('\n✅ 删除成功，数据已正确更新为 deleted 状态');
  } else if (afterDelete?.status === 'active') {
    console.log('\n❌ 删除似乎没有生效，status 仍为 active');
    console.log('   这可能是因为：');
    console.log('   1. RLS 策略阻止了 service_role 客户端的更新');
    console.log('   2. 触发器将 status 重置回 active');
  }

  // 恢复测试记录
  console.log('\n🔄 恢复测试记录...');
  await supabase
    .from('knowledge_items')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', testItem.id);

  console.log('✓ 已恢复');

  console.log('\n✅ 诊断完成\n');
}

checkKnowledgeItems().catch(console.error);
