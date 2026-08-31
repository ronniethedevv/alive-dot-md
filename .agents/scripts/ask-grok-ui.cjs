// Consult Grok 4.5 on the landing page UI (vibecode mode, per .agents/AGENTS.md).
//
//   node .agents/scripts/ask-grok-ui.cjs
//
// Writes .agents/scripts/grok-ui-result.md

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const SERVER_PATH = "C:/Users/USER/.gemini/mcp-servers/node_modules/@blockrun/mcp/dist/index.js";
const OUT = path.join(__dirname, "grok-ui-result.md");
const APP = path.join(__dirname, "..", "..", "packages", "web-app");

const read = (p) => fs.readFileSync(path.join(APP, p), "utf8");

const prompt = `[vibecode]

You are the design lead for a web product. I need a redesign of one landing page.
I will implement whatever you produce, so give me real code, not descriptions.

# HARD CONSTRAINTS (non-negotiable)

1. NEVER use em dashes (—) or en dashes (–) anywhere: not in copy, not in
   comments, not in code. Use commas, colons, full stops or parentheses. This is
   the single most important formatting rule. Check your output before returning.
2. Fonts are fixed. Do not propose alternatives:
   - sans: "Space Grotesk"  (var(--font-sans))
   - serif: "Fraunces"      (var(--font-serif))
   - mono: "JetBrains Mono" (var(--font-mono))
   Fraunces is currently UNUSED. Give it a real job.
3. Colours are fixed: light blue and white only, plus neutrals derived from the
   blue. One accent. No second hue. Tokens listed below. A single reserved red
   exists for system failure only and must not be used for content.
4. Stack is fixed: React 19, Vite, Tailwind v4 (CSS-first @theme, no config
   file), framer-motion 13, lucide-react. TypeScript.
5. NO MOCK DATA. Every number rendered comes from a live API. If you invent a
   figure in example code, label it clearly as a placeholder binding.
6. Animations must FAIL OPEN. This is a hard rule learned from two production
   bugs on this page: content must never be invisible or wrong because an
   animation did not run. Specifically:
   - Do not gate content on IntersectionObserver firing.
   - Do not gate content on requestAnimationFrame firing (it does not fire in
     hidden or backgrounded tabs).
   - Respect prefers-reduced-motion.
   If your design needs a reveal, it must render visible content when the
   trigger never fires.

# WHAT THE PRODUCT IS

A marketplace for hiring AI agents on BNB Chain, built on the ERC-8004 agent
registry. Judged by a hackathon on "how easily someone can discover and hire an
agent".

The core argument, which the whole UI exists to express:

  Anyone can register an agent on chain and CLAIM it does anything. Nothing
  checks it. We call every endpoint ourselves and publish what came back.

  321,016 agents are registered. 177 answered when called. A competing indexer
  that trusts registrations lists all 321,016.

That gap is the product. The design must make a reader feel it, not just read it.

Second argument: there is no global reputation score on this chain (the standard
refuses to return one because unfiltered ratings are trivially gamed). So we
publish what a score would be MADE OF instead of inventing a number. The three
components are provenance (who operates the agent), rater concentration (who
rates it), and closure (whether those raters are independent).

Real figures currently served, for context on magnitudes:
  corpus 321,016 | declares a machine interface 30,837 | verified hireable 177
  agents with any feedback 4,401 | DISTINCT RATERS IN THE WHOLE REGISTRY: 108
  99.3% of rated agents have raters who also rate the same other agents
  largest operator holds 34.6% of the entire registry

# THE CLAIMED / VERIFIED RULE

With one accent colour, the distinction is carried by WEIGHT, and this is
absolute:
  VERIFIED (we called it and it answered) = FILLED blue.
  CLAIMED  (the operator asserted it)     = OUTLINED, dashed, never filled.
Do not invert this. Do not introduce a second hue to carry it.

# CURRENT DESIGN TOKENS (src/index.css)

\`\`\`css
${read("src/index.css").slice(0, 3000)}
\`\`\`

# CURRENT LANDING PAGE (src/Landing.tsx)

This is what I want redesigned. Five sections: hero, "a registration is a
claim", "what a score is made of", "hiring is escrowed", and a closing call to
action into the catalog.

\`\`\`tsx
${read("src/Landing.tsx")}
\`\`\`

# THE SCROLL STEPPER I ALREADY BUILT (src/components/HiringFlow.tsx)

Improve or replace it.

\`\`\`tsx
${read("src/components/HiringFlow.tsx")}
\`\`\`

# WHAT I WANT FROM YOU

The current page is competent and boring. It reads like a spec sheet. I want a
modern agentic-product landing page: confident, spatial, with motion that means
something. Think of the best of Linear, Vercel, Stripe and Framer, but not a
copy of any of them, and not a generic AI startup page.

Deliver, in this order:

1. A short design direction: the one idea the page is built around, and what
   you are deliberately NOT doing. Maximum 200 words.

2. For EACH of the five sections: the layout concept, and why that layout
   serves that specific content. Say where you moved things and what you cut.

3. At least three CREATIVE, specific animation or interaction ideas that serve
   the argument rather than decorating it. For example, something that makes
   321,016 versus 177 physically felt. Describe the mechanic, then give the
   code. Remember the fail-open rule.

4. Real, complete, copy-pasteable code:
   - the updated @theme block if you change tokens
   - any new CSS component classes
   - full .tsx for the sections you redesign
   - full .tsx for each new component
   Use Tailwind utility classes with the existing token names. Assume the token
   names above exist; if you add tokens, define them.

5. Typography specifics: exactly where Fraunces goes, at what sizes and
   weights, and where it must not go.

Be opinionated. If a section should be cut or merged, say so and show the
result. Prefer fewer, better moments over many small ones.

Remember: no em dashes anywhere in your reply.`;

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
    send("initialize", {
      protocolVersion: "2024-11-05", capabilities: {},
      clientInfo: { name: "br", version: "1.0" },
    });
    setTimeout(() => {
      server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      send("tools/call", { name, arguments: args });
    }, 2000);
    setTimeout(() => { server.kill(); reject(new Error("timeout after 15m")); }, 900000);
  });
}

(async () => {
  console.log(`prompt is ${prompt.length} chars; asking xai/grok-4.5 ...`);
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const out = await callTool("blockrun_chat", {
        model: "xai/grok-4.5",
        message: prompt,
        max_tokens: 65536,
      });
      if (!out.trim()) { console.log(`attempt ${attempt}: empty, retrying`); continue; }
      fs.writeFileSync(OUT, out);
      const dashes = (out.match(/[—–]/g) || []).length;
      console.log(`SUCCESS: ${out.length} chars -> ${OUT}`);
      console.log(dashes ? `WARNING: ${dashes} em/en dashes present, strip before use` : "clean: no em dashes");
      return;
    } catch (e) {
      console.log(`attempt ${attempt} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  process.exit(1);
})();
