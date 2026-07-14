/**
 * Debug raw Sensenova streaming response
 */
const https = require('https');

const apiKey = 'sk-o2uUmYM8Qbzo6NSV3PvKamRElMZEk4H9';
const body = JSON.stringify({
  model: 'sensenova-6.7-flash-lite',
  messages: [{ role: 'user', content: '你好' }],
  stream: true,
  max_tokens: 20
});

const opts = {
  hostname: 'token.sensenova.cn',
  port: 443,
  path: '/v1/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + apiKey
  }
};

const req = https.request(opts, (res) => {
  let count = 0;
  res.on('data', (chunk) => {
    count++;
    const text = chunk.toString();
    console.log(`=== Chunk ${count} (${text.length} bytes) ===`);
    // Print first 3 chunks fully, rest just length
    if (count <= 3) {
      console.log(text.substring(0, 500));
    } else {
      console.log(text.substring(0, 200));
    }
    console.log('');
  });

  res.on('end', () => {
    console.log(`Total chunks: ${count}`);
  });
});

req.on('error', console.error);
req.write(body);
req.end();
