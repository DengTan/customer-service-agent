/**
 * Sensenova Connection Test
 * Run: node scripts/test-sensenova.js
 */

const https = require('https');

// Test Sensenova API connection
async function testSensenova() {
  console.log('Testing Sensenova API Connection...\n');
  
  const apiKey = 'sk-o2uUmYM8Qbzo6NSV3PvKamRElMZEk4H9';
  const baseUrl = 'https://token.sensenova.cn/v1';
  
  const body = JSON.stringify({
    model: 'sensenova-6.7-flash-lite',
    messages: [{ role: 'user', content: 'Hello!' }],
    max_tokens: 50
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
  
  console.log('Request:');
  console.log('  URL:', baseUrl + '/chat/completions');
  console.log('  Model:', 'sensenova-6.7-flash-lite');
  console.log('');
  
  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        console.log('Response Status:', res.statusCode);
        console.log('');
        
        try {
          const data = JSON.parse(responseBody);
          console.log('Response:');
          console.log(JSON.stringify(data, null, 2).substring(0, 500));
          
          if (res.statusCode === 200) {
            console.log('\n✅ Sensenova API is working!');
            console.log('   Model: sensenova-6.7-flash-lite');
            console.log('   Response:', data.choices?.[0]?.message?.content || 'No content');
          } else {
            console.log('\n❌ Sensenova API returned an error');
          }
        } catch (e) {
          console.log('Raw response:', responseBody);
        }
        
        resolve();
      });
    });
    
    req.on('error', (e) => {
      console.error('❌ Request failed:', e.message);
      resolve();
    });
    
    req.write(body);
    req.end();
  });
}

testSensenova();
