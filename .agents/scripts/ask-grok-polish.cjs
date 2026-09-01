// Third consult: production-readiness review of the app UI (vibecode mode).
//   node .agents/scripts/ask-grok-polish.cjs
// Writes .agents/scripts/grok-polish-result.md

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const SERVER_PATH = "C:/Users/USER/.gemini/mcp-servers/node_modules/@blockrun/mcp/dist/index.js";
const OUT = path.join(__dirname, "grok-polish-result.md");
const APP = path.join(__dirname, "..", "..", "packages", "web-app");
const read = (p) => fs.readFileSync(path.join(APP, p), "utf8");

const prompt = `[vibecode]

Third pass. You designed this landing page and I built the rest of the app on
top of your direction. The client now wants it to feel like a production
product rather than a hackathon build. Their words: "much more industry
standard".

That phrase is too vague to act on, so I have sharpened it below. Answer the
sharpened version.

# WHAT I ACTUALLY WANT FROM YOU

A production-readiness review with code. Concretely, find where this falls
short of what a shipped fintech or developer-tools product does, in these
areas, in roughly this priority order:

1. ACCESSIBILITY. Keyboard operability end to end, focus management on route
   change and in the wallet menu, focus traps where needed, ARIA for the
   live-updating regions, screen reader semantics for the data tables and the
   score rings, skip link, and whether any control is mouse only. Be specific
   and give the fix.
2. STATE COVERAGE. Every screen needs loading, empty, error, offline, partial
   and permission-denied states. Tell me which are missing or weak. In
   particular: what happens on a slow network, on a failed route, on an unknown
   agent id, on a wallet that disconnects mid flow.
3. FORM AND FLOW QUALITY on the hire screen. Validation timing, error recovery,
   preventing double submission, what happens if the user closes the tab
   between transaction two and three, and whether the irreversible step is
   sufficiently guarded.
4. DESIGN SYSTEM CONSISTENCY. I have drifted: ad hoc spacing, one off font
   sizes, inconsistent radii and repeated class strings. Propose a tightened
   token set and the component primitives that should exist (Button, Card,
   Field, Table, Badge, EmptyState) with real code, and say which existing
   markup should be replaced by them.
5. INFORMATION HIERARCHY AND DENSITY. Where is the eye going wrong, what is
   over emphasised, what is buried.
6. PERFORMANCE AND CORRECTNESS. Unnecessary re-renders, unstable keys, layout
   thrash in scroll handlers, uncancelled fetches on unmount, polling that
   should back off.

# HARD CONSTRAINTS, UNCHANGED

1. NEVER use em dashes or en dashes anywhere, including code comments. Check
   before returning.
2. Fonts fixed: Space Grotesk (sans), Fraunces (serif, display only), JetBrains
   Mono (mono, all figures).
3. Colours fixed. The brand blue is now #1256E0 and the family is derived from
   it. One accent. One reserved red for system failure only.
4. Stack fixed: React 19, Vite, Tailwind v4 CSS first, framer-motion 13,
   lucide-react, react-router-dom 7, TypeScript strict. No new dependencies
   unless one genuinely earns its place, and say why if so.
5. NO MOCK DATA. Every figure comes from the live API. Do not introduce
   fixtures, placeholder numbers or sample rows.
6. MOTION AND CONTENT MUST FAIL OPEN. Content must never be invisible or wrong
   because an observer, a scroll listener or requestAnimationFrame did not
   fire. rAF does not run in hidden tabs. Every animated value needs a correct
   resting default. Honour prefers-reduced-motion.
7. The CLAIMED versus VERIFIED distinction is carried by weight and is
   absolute: verified is FILLED, claimed is OUTLINED and dashed, never
   inverted, never a second hue.

# THE PRODUCT

A marketplace for hiring AI agents on BNB Chain, judged on how easily someone
can discover and hire an agent. 321,016 agents are registered on the ERC-8004
registry; 177 answered when we called their endpoint. We publish both facts and
never merge them.

Six routes:
  /                  landing, marketing, live figures
  /catalog           the app: dense rows, search, verified-only filter, sort,
                     pagination, hidden count always visible
  /agent/:agentId    detail, declared vs verified panels, signals, feedback
  /hire/:agentId     compose task and conditions, review, then three wallet
                     transactions: createJob, approve, fund
  /job/:jobId        lifecycle, terms, evaluator reason hash, polls every 15s
  /docs              long form explanation

API: GET /api/stats, /api/agents, /api/agents/:id, /api/jobs/:id.
Wallet: injected EIP-1193 only. The app never touches a private key.

# CURRENT CODE

## src/index.css
\`\`\`css
${read("src/index.css")}
\`\`\`

## src/Catalog.tsx
\`\`\`tsx
${read("src/Catalog.tsx")}
\`\`\`

## src/Hire.tsx
\`\`\`tsx
${read("src/Hire.tsx")}
\`\`\`

## src/components/Wallet.tsx
\`\`\`tsx
${read("src/components/Wallet.tsx")}
\`\`\`

## src/components/ui.tsx
\`\`\`tsx
${read("src/components/ui.tsx")}
\`\`\`

Also present, not pasted to keep this readable: src/Landing.tsx,
src/AgentDetail.tsx, src/Job.tsx, src/Docs.tsx, src/components/motion.tsx
(Parallax, Tilt, Magnetic, Odometer, Marquee, Rise), GapMeter.tsx,
HiringFlow.tsx, CatalogMock.tsx, AgentTicker.tsx, ScoreRing.tsx, SiteFooter.tsx.
Ask for any of them if a recommendation depends on the detail.

# DELIVER

1. A ranked list of the ten most important gaps, worst first, each in one
   sentence with the reason it matters to a user.
2. For each of the six areas above: what is wrong now, and the fix.
3. Real, complete, copy pasteable code. Full files for anything you rewrite,
   full files for new primitives. Do not hand me fragments or diffs.
4. A short list of what you deliberately left alone and why, so I do not
   mistake silence for an oversight.

Prefer a smaller number of deep, correct fixes over a long list of cosmetic
ones. If something I built is actually fine, say so plainly rather than
inventing work.

No em dashes anywhere in your reply.`;

function callTool(name, args) {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, [SERVER_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NODE_OPTIONS: "--dns-result-order=ipv4first" },
    });
    let buf = "", id = 0;
    const send = (method, params) =>
      server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) + "\n");
    server.stdout.on("data", (c) => {
      buf += c.toString();
      for (const line of buf.split("\n").filter((l) => l.trim())) {
        try {
          const msg = JSON.parse(line);
          if (msg.id !== 2) continue;
          server.kill();
          if (msg.error) return reject(new Error(JSON.stringify(msg.error).slice(0, 300)));
          const text = (msg.result?.content ?? []).map((b) => b.text ?? "").join("\n");
          if (msg.result?.isError || /fetch failed/i.test(text)) return reject(new Error(text.slice(0, 300)));
          resolve(text);
        } catch { /* partial line */ }
      }
    });
    server.stderr.on("data", () => {});
    send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "br", version: "1.0" } });
    setTimeout(() => {
      server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      send("tools/call", { name, arguments: args });
    }, 2000);
    setTimeout(() => { server.kill(); reject(new Error("timeout after 15m")); }, 900000);
  });
}

(async () => {
  console.log(`prompt ${prompt.length} chars, asking xai/grok-4.5 for a production readiness review`);
  for (let i = 1; i <= 5; i++) {
    try {
      const out = await callTool("blockrun_chat", { model: "xai/grok-4.5", message: prompt, max_tokens: 65536 });
      if (!out.trim()) { console.log(`attempt ${i}: empty, retrying`); continue; }
      fs.writeFileSync(OUT, out);
      const d = (out.match(/[—–]/g) || []).length;
      console.log(`SUCCESS ${out.length} chars -> ${OUT}`);
      console.log(d ? `WARNING ${d} dashes present, strip before use` : "clean, no dashes");
      return;
    } catch (e) {
      console.log(`attempt ${i} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  process.exit(1);
})();
