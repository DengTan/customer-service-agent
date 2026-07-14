/**
 * Test LLMClientAdapter directly with Sensenova streaming
 */

const { LLMClientAdapter } = require('./src/server/services/llm-client-adapter.ts');

async function main() {
  console.log('Testing LLMClientAdapter with Sensenova...\n');

  const adapter = new LLMClientAdapter({
    baseUrl: 'https://token.sensenova.cn',
    apiKey: 'sk-o2uUmYM8Qbzo6NSV3PvKamRElMZEk4H9',
  });

  const messages = [
    { role: 'system', content: '你是智能客服助手' },
    { role: 'user', content: '你好，请介绍一下你自己' }
  ];

  console.log('Starting stream...');
  let count = 0;
  let fullContent = '';

  try {
    for await (const chunk of adapter.stream(messages, { model: 'sensenova-6.7-flash-lite', max_tokens: 50 })) {
      count++;
      if (chunk.content) {
        fullContent += chunk.content;
        console.log(`[${count}] content: "${chunk.content}"`);
      } else {
        console.log(`[${count}] no content, chunk:`, JSON.stringify(chunk));
      }
    }
    console.log('\nTotal chunks:', count);
    console.log('Full content:', fullContent || '(empty)');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
