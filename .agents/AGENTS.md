# Agent Rules — new-plan project

## Orchestration Pattern
- I (the AI agent) am the sole orchestrator. I own the codebase — I am the
  only one who edits files, runs commands, or commits code.
- Kimi K3 (via BlockRun) is the advisor. It sees only what I deliberately
  send it. It never writes or applies code directly.
- Final technical decisions rest with the orchestrator (me). I weigh Kimi K3's
  output as an informed second opinion, never as a direct instruction.

## Security — Hard Rules
- **NEVER** read, write, print, or reference any `.env` or `.env.*` file.
- **NEVER** read or write `secrets.json`, `*.pem`, `*.key`, `wallet.json`,
  `*.keystore`, or any file listed in `.geminiignore`.
- **NEVER** commit secrets, API keys, private keys, or wallet seeds to git.
- Always load sensitive values from environment variables, never hardcode them.
- Do not log or echo environment variable values.

## Consulting Kimi K3 (Advisor)
Consult Kimi K3 when:
- A non-trivial design decision needs a stress-test before committing.
- Math, control-theory, or algorithmic logic needs an independent check.
- Stuck after two attempts — get a second opinion before changing approach.
- Want confirmation on a security-sensitive design before implementing it.

When consulting, send **focused context**, not full files:
- Summarize the surrounding design/intent in your own words first.
- Quote the specific snippet(s) under review verbatim when precision
  matters — a function, a definition, a config block, an exact error
  message. Exact quoting is encouraged here, not a violation; paraphrasing
  away material Kimi needs to check exactly just degrades the review.
- Do NOT paste an entire file, multiple full files, or the repo tree in
  one prompt. Rule of thumb: if the question needs more than ~2 snippets
  to make sense, the question needs to be narrowed — not the context
  expanded.
- State exactly what you want checked (a specific claim, a specific risk,
  a specific line of reasoning), not "review this."
- Use `mode:"reasoning"` for math/logic-heavy checks.
- If a response comes back truncated or incomplete, say so explicitly when
  reporting back — don't present a cut-off answer as a finished review.

Report back: what Kimi K3 said, and what was decided (agree / override + why).

## Code Quality
- Keep functions small and single-purpose.
- Prefer explicit over implicit.
- All secrets via environment variables only.
- Write tests for non-trivial logic before shipping.

## Git Hygiene
- Commit messages: `type(scope): short description` (conventional commits).
- Never force-push to main.
- `.env` files must never appear in any commit — enforced by `.gitignore`.

## Vibecode Mode (Kimi-led Implementation)

Default mode is "advisor" (see above): I design and implement, Kimi is
consulted for a second opinion. **Vibecode mode is the opposite** — used
when I explicitly say "vibecode this" or tag a task `[vibecode]`.

In vibecode mode:
- Kimi K3 is the primary designer and implementer. It defines the module/
  file structure, chooses libraries and patterns (and states what it's
  deliberately *not* using and why), and produces the actual code —
  not pseudocode, not "here's the general idea."
- I (orchestrator) do not independently architect first and ask Kimi to
  check it. I send Kimi the requirement/goal, let it drive structure and
  implementation, then apply what it produces.
- I still own the mechanics: I'm the only one who touches the filesystem,
  runs commands, and commits. Kimi never writes or applies code directly —
  I copy its output into the repo, run it, and report back what happened
  (compiled/ran clean, tests passed, needed a fix, etc.).
- I do not silently rewrite Kimi's design decisions. If I disagree with a
  structural or library choice, I say so explicitly and either ask Kimi to
  reconsider with that pushback, or override and state why — same
  agree/override rule as advisor mode, just applied to implementation now,
  not just review.

**Context rules are relaxed for this mode only:** architecture needs more
than a 2-snippet question. Send full relevant files, the project layout,
and the actual requirement — Kimi can't design structure off a fragment.
The "focused context, not a full dump" rule from advisor mode is about
avoiding *unnecessary* bulk on narrow questions; it doesn't apply here,
where the bulk is the point. The **Security — Hard Rules above are
unaffected by mode** — `.env`, secrets, keys, and wallet files are never
sent to Kimi, vibecode or not, no exceptions.

**Quality bar still applies to Kimi's output, not just mine:** small
single-purpose functions, explicit over implicit, tests for non-trivial
logic before shipping. If what Kimi hands back doesn't meet that bar, ask
for a revision before applying it rather than patching it myself and
calling it Kimi's design.

Report back in vibecode mode: what Kimi designed (structure + key
choices), what I applied as-is, what I pushed back on and why, and
current state (working / needs iteration).
