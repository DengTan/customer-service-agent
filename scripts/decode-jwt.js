const https = require('https');

function decodeBase64Url(str) {
  // Convert base64url to base64
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJhbm9uIn0.Ud02Pbuv5gdh_BhUx0cSmUSsh9fLtxp3VXqRS65AA8E';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNjE1NzQ3MzksInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.o_YsuAqvnACfooDVkx79nFI-LHiDP10HApRYCuq9Kl8';

function decodeJWT(token) {
  const parts = token.split('.');
  const header = JSON.parse(decodeBase64Url(parts[0]));
  const payload = JSON.parse(decodeBase64Url(parts[1]));
  return { header, payload };
}

console.log('=== JWT 解码 ===\n');

console.log('ANON_KEY:');
const anon = decodeJWT(ANON_KEY);
console.log('  Header:', JSON.stringify(anon.header));
console.log('  Payload:', JSON.stringify(anon.payload));

console.log('\nSERVICE_KEY:');
const svc = decodeJWT(SERVICE_KEY);
console.log('  Header:', JSON.stringify(svc.header));
console.log('  Payload:', JSON.stringify(svc.payload));

console.log('\n=== 对比 ===');
console.log('ANON role:', anon.payload.role);
console.log('SERVICE role:', svc.payload.role);
