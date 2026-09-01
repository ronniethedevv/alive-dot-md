# Runbook: everything pending on your side

All CLI. Roughly 40 minutes, most of it waiting for a deploy.

Work through it in order. Steps 1 to 3 must happen in sequence, because
registering an agent writes its URL on chain permanently and you cannot register
before the URL exists.

---

## 0. The wallet question, answered

**Use a disposable wallet. It is the right choice here, not a shortcut.**

Measured on chain just now, at 0.05 gwei:

| | |
|---|---|
| One `register()` | 191,934 gas, **0.0000096 BNB** |
| Three registrations | **0.000029 BNB** |
| Whole demo, 6 transactions | **0.000058 BNB** |

Fund it with **0.01 BNB** and you have a 170x margin on the entire exercise.
The maximum loss if that key leaks is whatever you put in it, and there is no
reason to put more than a few dollars in it.

**One caveat, and it is the only real one.** ERC-8004 agents are ERC-721 tokens
owned by the address that registered them. If you lose this key you lose the
ability to update those three agents, for example if the deploy URL ever
changes. That is survivable for a hackathon and not survivable for a product.
So: keep the key safe until after judging, and do not transfer the agents,
because `agentWallet` is cleared on transfer and must be re-proven by the new
owner.

Do **not** use a wallet that holds anything you care about. Nothing in this
runbook needs one.

---

## 1. Create and fund the wallet

```bash
cast wallet new
```

That prints an address and a private key. Save the key somewhere you will still
have it next week, then:

```bash
export ALIVE_ADDR=0xYourNewAddress
export ALIVE_KEY=0xYourPrivateKey
export ETH_RPC_URL=https://bsc.rpc.blxrbdn.com
```

Send **0.01 BNB** to `$ALIVE_ADDR` from an exchange or your usual wallet, then
confirm it arrived:

```bash
cast balance $ALIVE_ADDR --ether
```

> Never paste a private key into a chat, a web page, an issue, or a commit.
> `.env` is gitignored in this repo, and no code here reads a key.

---

## 2. Deploy the agent service

The registrations you write in step 3 point at this URL and cannot be edited
without another transaction, so this comes first.

```bash
fly launch --no-deploy          # once, to create the app
fly secrets set AGENT_BASE_URL=https://bnb-mrkt-agents.fly.dev
fly deploy
```

`fly.toml` is already in the repo and pinned to `min_machines_running = 1`.
That is deliberate: our own verifier probes this service, and a cold start would
be recorded as `unreachable`, which is exactly the verdict we publish about
other people's agents.

Check it is really up before continuing:

```bash
curl -s https://bnb-mrkt-agents.fly.dev/ | head -20
curl -s https://bnb-mrkt-agents.fly.dev/agents/bsc-address-inspector/registration.json | head -30
```

Both must return JSON. If the second one 404s, stop and fix it: registering
against a broken URL puts a permanently dead agent on mainnet, which is the
exact defect this project exists to catalogue.

*(Any host works. Render, Railway, or a Cloudflare tunnel are all fine. The
only requirements are a public HTTPS URL and no cold starts.)*

---

## 3. Register the three agents

Generate the registration files and the exact calldata:

```bash
node --experimental-strip-types packages/agents/src/seed.ts \
  --base https://bnb-mrkt-agents.fly.dev
```

It refuses to emit real calldata against a localhost URL, so if you skipped
step 2 it will tell you.

Then one transaction per agent:

```bash
for slug in bsc-address-inspector endpoint-liveness erc8004-registration-auditor; do
  cast send 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 \
    "register(string)" \
    "https://bnb-mrkt-agents.fly.dev/agents/$slug/registration.json" \
    --private-key $ALIVE_KEY --rpc-url $ETH_RPC_URL
done
```

Each prints a receipt. **Record the three agent ids**: `register()` returns the
new token id, and it is in the logs of each receipt. To read one back:

```bash
cast receipt <txhash> --rpc-url $ETH_RPC_URL | grep -A2 topics
```

---

## 4. Mark them as ours

Non-negotiable, and it is an honesty requirement rather than a feature. The
catalog argues that directories hide their own composition. Unlabelled
first-party supply, found by a judge, would hand them our own argument.

```bash
node --experimental-strip-types packages/agents/src/seed.ts \
  --claim <agentId> bsc-address-inspector
# repeat for the other two
```

`first_party` is only ever set by this command. The resolver never writes it,
so a re-sweep cannot silently unmark them.

---

## 5. Get them listed, immediately

No waiting for a sweep:

```bash
for id in <id1> <id2> <id3>; do
  curl -s -X POST http://localhost:8787/api/agents/$id/verify | head -8
done
```

You want `"verifiedClass": "task-interface"` and `"listed": true`.

Anything else is the real answer and worth reading: `no-interface` means the
registration declares no callable endpoint, `dead` means the host answered with
an error, `unreachable` usually means the deploy is not public yet.

Then confirm they are in the catalog:

```bash
curl -s "http://localhost:8787/api/agents?perPage=100" \
  | grep -c '"firstParty": true'
```

Should print `3`.

---

## 6. Get some U

Escrow settles in U and nothing else. That is immutable on the Commerce kernel,
not our choice.

Our three agents charge 0.2, 0.1 and 0.5 U, so **2 U covers the demo
comfortably**.

The liquid venue is the PancakeSwap **V3** pool, not V2:

- Pool: `0xA0909f81785f87f3e79309F0E73A7d82208094E4` (U/USDT, 0.01% fee)
- Depth as measured: about 11M U against 10M USDT

Swap a few USDT for U in the PancakeSwap UI with this wallet connected. Then:

```bash
cast call 0xcE24439F2D9C6a2289F741120FE202248B666666 \
  "balanceOf(address)(uint256)" $ALIVE_ADDR --rpc-url $ETH_RPC_URL
```

> The V2 pair for U holds about 1.3 cents and looks like proof that U is
> untradeable. It is an abandoned shell. Use V3.

---

## 7. Run one real hire, before you record anything

This is the step that matters most, and the one most likely to surface
something. Every part of the hire flow has been verified against jobs other
people created. **No job has ever been created by this system.**

Open the app, connect this wallet, and hire one of your own agents:

```bash
npm run api      # terminal 1
npm run web      # terminal 2
```

Then in the browser: Browse, open one of your three agents, Hire, describe a
task, **Ask this agent what it charges**, accept the quote, and sign the three
transactions.

Expect something to break the first time. That is the point of doing it before
recording.

---

## Order of dependencies

```
wallet ──> deploy ──> register ──> claim ──> verify ──> listed
                                                 │
                            get U ───────────────┴──> first real hire
```

---

## What is on my side, not yours

- Verifier cron, so listings stay current without anyone asking
- The "list your agent" screen, so operators can do step 5 without curl
- Job actions (submit, settle, decline) on the job screen
- Renaming the project to ALIVE.md across the UI and docs

---

## If something goes wrong

**`fly deploy` succeeds but the URL 404s.** The Dockerfile copies
`packages/agents/src`, `packages/shared/src` and `indexer/src`. If you moved
files, it will build and then fail at import.

**`register()` reverts.** Usually the URI is over the on-chain description cap.
Keep it short.

**Verify returns `unreachable`.** Our SSRF guard refuses private and loopback
addresses. If you deployed somewhere that resolves to a private IP, that is the
cause and it is working as intended.

**Verify returns `html`.** The endpoint answered with a web page rather than
JSON, which usually means a platform holding page is in front of the service.
