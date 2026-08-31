const { spawn } = require('child_process');
const fs = require('fs');

/**
 * Template Kimi K3 advisor script (BlockRun MCP)
 * 
 * Usage:
 *   1. Edit the promptText below.
 *   2. Run: node .agents/scripts/ask-kimi-template.js
 */

const SERVER_PATH = 'C:/Users/USER/.gemini/mcp-servers/node_modules/@blockrun/mcp/dist/index.js';
const OUTPUT_FILE = '.agents/scripts/result.txt';

const promptText = \
[advisor]

<REPLACE WITH YOUR QUESTION / CONTEXT / SNIPPETS>
\;

function callTool(toolName, toolArgs) {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, [SERVER_PATH], { 
      stdio: ['pipe', 'pipe', 'pipe'],
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
            if (msg.result?.isError || (msg.result?.content && msg.result.content[0]?.text?.includes('fetch failed'))) {
              reject(new Error(msg.result.content[0]?.text || 'isError=true'));
            } else if (msg.result?.content) {
              resolve(msg.result.content.map(b => b.text || JSON.stringify(b)).join('\n'));
            } else if (msg.error) {
              reject(msg.error);
            }
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
    setTimeout(() => { server.kill(); reject(new Error('Timeout')); }, 900000); // 15 mins
  });
}

async function main() {
  console.log('=== Sending request to Kimi K3 ===');
  
  for (let i = 1; i <= 10; i++) {
    console.log(\Attempt \...\);
    try {
      const result = await callTool('blockrun_chat', {
        model: 'moonshot/kimi-k3',
        message: promptText,
        max_tokens: 65536
      });
      
      if (!result.trim() || result.includes('{"type":"text","text":""}')) {
        console.log('Got empty result, retrying...');
        continue;
      }
      
      fs.writeFileSync(__dirname + '/result.txt', result);
      console.log('Result saved to result.txt');
      console.log('SUCCESS');
      break;
    } catch (e) {
      console.log('Error:', e.message);
      console.log('Retrying in 2s...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

main();
