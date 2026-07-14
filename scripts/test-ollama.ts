import 'dotenv/config';

async function testModel(model: string) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Testing model: ${model}`);
  console.log('='.repeat(50));
  
  const start = Date.now();
  
  try {
    const response = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: '这是一条测试文本，用于验证嵌入模型是否正常工作。' })
    });
    
    const elapsed = Date.now() - start;
    const data = await response.json();
    
    console.log(`Status: ${response.status}`);
    console.log(`Time: ${elapsed}ms`);
    
    if (data.error) {
      console.log(`Error: ${data.error}`);
      return { success: false, error: data.error };
    }
    
    console.log(`Has embedding: ${!!data.embedding}`);
    console.log(`Embedding length: ${data.embedding?.length || 0}`);
    console.log(`First 5 values: ${data.embedding?.slice(0, 5)}`);
    
    return { success: true, length: data.embedding?.length || 0, time: elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`Error: ${msg}`);
    console.log(`Time: ${elapsed}ms`);
    return { success: false, error: msg, time: elapsed };
  }
}

async function test() {
  console.log('Testing Ollama embedding models...');
  console.log(`Primary: bge-m3:567m`);
  console.log(`Fallback: mxbai-embed-large`);
  
  // 测试主模型
  const primary = await testModel('bge-m3:567m');
  
  // 测试备用模型
  const fallback = await testModel('mxbai-embed-large');
  
  // 总结
  console.log('\n' + '='.repeat(50));
  console.log('Summary');
  console.log('='.repeat(50));
  console.log(`Primary (bge-m3:567m):   ${primary.success ? '✓ OK' : '✗ FAIL'} (${primary.time}ms)`);
  console.log(`Fallback (mxbai-embed-large): ${fallback.success ? '✓ OK' : '✗ FAIL'} (${fallback.time}ms)`);
  
  if (primary.success) {
    console.log(`\n>>> 主模型可用，将使用 bge-m3:567m <<<`);
  } else if (fallback.success) {
    console.log(`\n>>> 主模型不可用，将降级使用 mxbai-embed-large <<<`);
  } else {
    console.log(`\n>>> 警告: 所有模型都不可用 <<<`);
  }
}

test().catch(console.error);
