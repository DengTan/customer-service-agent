import 'dotenv/config';

async function testEmbedding() {
  console.log('Testing Ollama embedding API...');
  
  const testTexts = [
    '这是测试文本1',
    '这是测试文本2',
    '这是测试文本3'
  ];
  
  for (let i = 0; i < testTexts.length; i++) {
    const text = testTexts[i];
    try {
      const response = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          model: 'mxbai-embed-large', 
          prompt: text 
        })
      });
      
      const data = await response.json();
      
      console.log(`\nText ${i + 1}:`);
      console.log('  Status:', response.status);
      console.log('  Has embedding:', !!data.embedding);
      console.log('  Length:', data.embedding?.length || 0);
      console.log('  First 5 values:', data.embedding?.slice(0, 5));
      
      if (data.error) {
        console.log('  Error:', data.error);
      }
    } catch (err: unknown) {
      const error = err as Error;
      console.log(`\nText ${i + 1} Error:`, error?.message);
    }
  }
}

testEmbedding();
