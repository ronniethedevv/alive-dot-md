const { spawn } = require('child_process');
const SERVER_PATH = 'C:/Users/USER/.gemini/mcp-servers/node_modules/@blockrun/mcp/dist/index.js';
const server = spawn(process.execPath, [SERVER_PATH], {
  stdio: ['pipe','pipe','pipe'],
  env: { ...process.env, NODE_OPTIONS: '--dns-result-order=ipv4first' }
});
let buf = '', id = 0;
const send = (method, params) => server.stdin.write(JSON.stringify({jsonrpc:'2.0',id:++id,method,params})+'\n');
server.stdout.on('data', c => {
  buf += c.toString();
  for (const line of buf.split('\n').filter(l=>l.trim())) {
    try {
      const m = JSON.parse(line);
      if (m.id === 2 && m.result) {
        for (const t of (m.result.tools||[])) {
          console.log('TOOL:', t.name, '-', (t.description||'').slice(0,110));
          const props = t.inputSchema?.properties||{};
          if (props.model) console.log('   model param:', JSON.stringify(props.model).slice(0,600));
        }
        server.kill(); process.exit(0);
      }
    } catch {}
  }
});
server.stderr.on('data', ()=>{});
send('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'br',version:'1.0'}});
setTimeout(()=>{ server.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n'); send('tools/list',{}); }, 2000);
setTimeout(()=>{ console.log('timeout'); process.exit(1); }, 30000);
