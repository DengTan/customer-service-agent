/**
 * Test Sensenova API response format
 */

const https = require('https');

const apiKey = 'sk-o2uUmYM8Qbzo6NSV3PvKamRElMZEk4H9';

async function test() {
  console.log('Testing Sensenova response format...\n');
  
  const body = JSON.stringify({
    model: 'sensenova-6.7-flash-lite',
    messages: [{ role: 'user', content: '你好，请介绍一下你自己' }],
    max_tokens: 100
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
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Response:', JSON.stringify(JSON.parse(data), null, 2));
        resolve();
      });
    });
    req.on('error', console.error);
    req.write(body);
    req.end();
  });
}

test();
