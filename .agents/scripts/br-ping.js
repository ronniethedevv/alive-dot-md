const { spawn } = require('child_process');
const SERVER_PATH = 'C:/Users/USER/.gemini/mcp-servers/node_modules/@blockrun/mcp/dist/index.js';

function callTool(toolName, toolArgs) {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, [SERVER_PATH], { 
      stdio: ['pipe', 'pipe', 'pipe'],
      // Force Node 18+ fetch to prefer IPv4, which avoids IPv6 routing timeouts
      env: { ...process.env, NODE_OPTIONS: '--dns-result-order=ipv4first' }
    });
    
    let stdout = '', msgId = 0;
    const send = (method, params) => {
      const msg = { jsonrpc: '2.0', id: ++msgId, method, params };
      server.stdin.write(JSON.stringify(msg) + '\n');
    };
    
    server.stdout.on('data', c => {
      stdout += c.toString();
      for (const line of stdout.split('\n').filter(l => l.trim())) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2) {
            server.kill();
            if (msg.result?.content) resolve(msg.result.content.map(b => b.text || JSON.stringify(b)).join('\n'));
            else if (msg.error) reject(msg.error);
          }
        } catch {}
      }
    });
    
    server.stderr.on('data', () => {});
    send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'br', version: '1.0' } });
    setTimeout(() => {
      server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      send('tools/call', { name: toolName, arguments: toolArgs });
    }, 2000);
    setTimeout(() => { server.kill(); reject(new Error('Timeout')); }, 30000);
  });
}

async function main() {
  console.log('=== Test ping to Kimi K3 (forcing IPv4) ===');
  try {
    const pingResult = await callTool('blockrun_chat', {
      model: 'moonshot/kimi-k3',
      message: 'Reply with exactly: "Kimi K3 advisor online. Ready."'
    });
    console.log(pingResult);
  } catch (e) {
    console.log('Error:', e);
  }
}

main();
