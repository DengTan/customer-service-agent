/**
 * 深度诊断脚本：测试 Supabase 查询缓存和 RLS
 * 
 * 运行方式：
 * $env:SUPABASE_URL="..."; $env:SUPABASE_SERVICE_ROLE_KEY="..."; npx tsx scripts/check-supabase-cache.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://avmregjnnsmshwxrwjie.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ 缺少环境变量：SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// 使用 service_role 客户端（绕过 RLS）
const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// 使用 anon 客户端（触发 RLS）
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2bXJlZ2pubnNtc2h3eHJ3amllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MDkzNzIsImV4cCI6MjA5ODA4NTM3Mn0.M2bx60X5DSzA7XjUJOh-IvrxhovJIB-7jTj8h-pIoHY';
const anonClient = createClient(SUPABASE_URL, ANON_KEY);

async function deepDiagnose() {
  console.log('\n🔍 Supabase 深度诊断\n');
  console.log('='.repeat(60));

  // 1. 测试 service_role 客户端
  console.log('\n[1] Service Role 客户端查询（绕过 RLS）');
  const { data: serviceData, error: serviceError } = await serviceClient
    .from('knowledge_items')
    .select('id, name, status')
    .neq('status', 'deleted')
    .limit(10);

  if (serviceError) {
    console.log(`❌ 错误: ${serviceError.message}`);
  } else {
    console.log(`✓ 返回 ${serviceData?.length || 0} 条记录（过滤 deleted 后）`);
    if (serviceData && serviceData.length > 0) {
      serviceData.forEach(item => {
        console.log(`   - ${item.name} (status: ${item.status})`);
      });
    }
  }

  // 2. 测试 anon 客户端（触发 RLS）
  console.log('\n[2] Anon 客户端查询（触发 RLS）');
  const { data: anonData, error: anonError } = await anonClient
    .from('knowledge_items')
    .select('id, name, status')
    .neq('status', 'deleted')
    .limit(10);

  if (anonError) {
    console.log(`❌ 错误: ${anonError.message}`);
  } else {
    console.log(`✓ 返回 ${anonData?.length || 0} 条记录（过滤 deleted 后）`);
    if (anonData && anonData.length > 0) {
      anonData.forEach(item => {
        console.log(`   - ${item.name} (status: ${item.status})`);
      });
    }
  }

  // 3. 测试不过滤 deleted 的查询
  console.log('\n[3] 不过滤 deleted 的查询（service_role）');
  const { data: allData } = await serviceClient
    .from('knowledge_items')
    .select('id, name, status')
    .limit(20);

  console.log(`✓ 总共 ${allData?.length || 0} 条记录:`);
  if (allData) {
    const statusCounts = { active: 0, archived: 0, deleted: 0, null: 0, other: 0 };
    allData.forEach(item => {
      const s = item.status || 'null';
      if (s in statusCounts) statusCounts[s as keyof typeof statusCounts]++;
      else statusCounts.other++;
    });
    console.log(`   active: ${statusCounts.active}`);
    console.log(`   archived: ${statusCounts.archived}`);
    console.log(`   deleted: ${statusCounts.deleted}`);
    console.log(`   null: ${statusCounts.null}`);
    console.log(`   other: ${statusCounts.other}`);
  }

  // 4. 测试 RLS 策略（查询 policy 信息）
  console.log('\n[4] 检查 RLS 策略');
  try {
    const { data: policies } = await serviceClient.rpc('pg_catalog.pg_policies', {
      schemaname: 'public',
      tablename: 'knowledge_items'
    });
    console.log(`✓ 查询到 ${policies?.length || 0} 个策略`);
  } catch (e) {
    // RPC 可能不可用，尝试直接查询
    console.log('   (无法通过 RPC 获取策略信息)');
  }

  // 5. 模拟前端行为：创建测试记录
  console.log('\n[5] 创建测试记录并立即查询');
  console.log('='.repeat(60));

  const testId = `test-${Date.now()}`;
  const { error: insertError } = await serviceClient
    .from('knowledge_items')
    .insert({
      id: testId,
      name: `测试记录 ${new Date().toLocaleString('zh-CN')}`,
      type: 'text',
      content: '这是测试内容',
      category: '测试',
      status: 'active'
    });

  if (insertError) {
    console.log(`❌ 创建失败: ${insertError.message}`);
  } else {
    console.log(`✓ 测试记录已创建: ${testId}`);

    // 立即查询
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const { data: immediateQuery } = await serviceClient
      .from('knowledge_items')
      .select('id, name, status')
      .eq('id', testId)
      .single();
    
    console.log(`\n立即查询结果:`);
    console.log(`   Status: ${immediateQuery?.status}`);
    console.log(`   Name: ${immediateQuery?.name}`);

    // 软删除
    console.log('\n执行软删除...');
    await serviceClient
      .from('knowledge_items')
      .update({ status: 'deleted' })
      .eq('id', testId);

    // 立即查询（模拟前端行为）
    const { data: afterDeleteQuery } = await serviceClient
      .from('knowledge_items')
      .select('id, name, status')
      .neq('status', 'deleted')
      .eq('id', testId);

    console.log(`\n删除后过滤查询结果:`);
    console.log(`   返回: ${afterDeleteQuery?.length || 0} 条`);

    const { data: afterDeleteAllQuery } = await serviceClient
      .from('knowledge_items')
      .select('id, name, status')
      .eq('id', testId);

    console.log(`\n删除后无条件查询结果:`);
    console.log(`   Status: ${afterDeleteAllQuery?.[0]?.status}`);

    // 清理测试记录
    console.log('\n清理测试记录...');
    await serviceClient
      .from('knowledge_items')
      .delete()
      .eq('id', testId);
    console.log('✓ 已清理');
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ 诊断完成\n');

  // 总结
  console.log('\n📋 诊断总结:\n');
  if (serviceData && serviceData.length > 0) {
    console.log('❌ 发现问题：service_role 客户端查询到非 deleted 记录');
    console.log('   这意味着 RLS 策略可能没有正确配置，导致未删除的记录被显示');
  } else if (anonData && anonData.length > 0) {
    console.log('❌ 发现问题：anon 客户端查询到非 deleted 记录');
    console.log('   这可能是正常的，符合预期的行为');
  } else {
    console.log('✓ 数据库中没有 active 状态的记录');
    console.log('   如果前端仍然显示数据，问题可能在：');
    console.log('   1. 前端 SWR 缓存');
    console.log('   2. 前端内存状态');
    console.log('   3. 浏览器缓存');
  }
}

deepDiagnose().catch(console.error);
