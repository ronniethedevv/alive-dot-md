/**
 * Direct test: attempts a raw x402 chat call to blockrun.ai
 * to reveal exactly which fetch is failing.
 */
const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 500) }));
    }).on('error', e => reject(e));
  });
}

async function main() {
  const tests = [
    'https://blockrun.ai/api/health',
    'https://blockrun.ai/v1/models',
    'https://mainnet.base.org',
    'https://rpc.ankr.com/base',
  ];

  for (const url of tests) {
    try {
      const r = await get(url);
      console.log(`✅ ${url} → HTTP ${r.status}`);
    } catch (e) {
      console.log(`❌ ${url} → ${e.message}`);
    }
  }
}

main();
