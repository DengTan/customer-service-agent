/**
 * Test Sensenova streaming response format
 */

const https = require('https');

const apiKey = 'sk-o2uUmYM8Qbzo6NSV3PvKamRElMZEk4H9';

async function test() {
  console.log('Testing Sensenova streaming...\n');
  
  const body = JSON.stringify({
    model: 'sensenova-6.7-flash-lite',
    messages: [{ role: 'user', content: '你好' }],
    max_tokens: 50,
    stream: true
  });
  
  const options = {
    hostname: 'token.sensenova.cn',
    port: 443,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    }
  };
  
  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      console.log('Status:', res.statusCode);
      console.log('Headers:', JSON.stringify(res.headers));
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString();
      });
      
      res.on('end', () => {
        console.log('\nAll chunks:');
        data.split('\n').forEach((line, i) => {
          if (line.trim()) {
            console.log(`Chunk ${i}:`, line.substring(0, 300));
          }
        });
        resolve();
      });
    });
    
    req.on('error', console.error);
    req.write(body);
    req.end();
  });
}

test();
