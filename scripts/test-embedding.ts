/**
 * 测试知识库导入和向量化
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getEmbeddingService } from '../src/server/services/embedding-service';
import { chunkText, extractTextFromBuffer, getFileType } from '../src/server/services/text-extractor';
import { randomUUID } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function test() {
  console.log('=== 测试知识库导入流程 ===\n');

  // 1. 测试 Ollama 连接
  console.log('1. 检查 Ollama 服务...');
  const embeddingService = getEmbeddingService();
  const isAvailable = await embeddingService.isAvailable();
  console.log('   Ollama 可用:', isAvailable);
  
  if (!isAvailable) {
    console.log('   错误: Ollama 服务未启动');
    return;
  }

  // 2. 测试文本提取
  console.log('\n2. 测试文本提取...');
  const testText = '这是退货政策。七天内可以无理由退货。商品需要保持原包装完好。';
  const chunks = chunkText(testText);
  console.log('   提取文本:', testText);
  console.log('   生成 chunks:', chunks.length);

  // 3. 测试向量化
  console.log('\n3. 测试向量化...');
  try {
    const embedding = await embeddingService.embed(testText);
    console.log('   向量维度:', embedding.length);
    console.log('   向量前5个值:', embedding.slice(0, 5));
  } catch (error: any) {
    console.log('   向量化失败:', error.message);
  }

  // 4. 测试插入 chunks（带 UUID）
  console.log('\n4. 测试插入 chunks 到数据库...');
  const testChunkId = randomUUID();
  
  try {
    // 先插入一个测试 item
    const { data: item, error: itemError } = await supabase
      .from('knowledge_items')
      .insert({
        name: '测试知识条目',
        type: 'text',
        content: testText,
        status: 'active',
        chunk_count: 1,
        embedding: null,
      })
      .select('id')
      .single();
    
    if (itemError) {
      console.log('   插入 item 失败:', itemError.message);
      return;
    }
    console.log('   插入 item 成功:', item.id);

    // 插入 chunk（带 UUID）
    const { error: chunkError } = await supabase
      .from('knowledge_chunks')
      .insert({
        id: randomUUID(),
        knowledge_item_id: item.id,
        chunk_index: 0,
        content: testText,
        content_hash: 'test-hash-123',
        version_added: 1,
      });
    
    if (chunkError) {
      console.log('   插入 chunk 失败:', chunkError.message);
      console.log('   Error details:', chunkError.details);
    } else {
      console.log('   插入 chunk 成功!');
    }

    // 清理测试数据
    await supabase.from('knowledge_chunks').delete().eq('knowledge_item_id', item.id);
    await supabase.from('knowledge_items').delete().eq('id', item.id);
    console.log('   清理测试数据完成');

  } catch (error: any) {
    console.log('   测试失败:', error.message);
  }

  console.log('\n=== 测试完成 ===');
}

test().catch(console.error);
