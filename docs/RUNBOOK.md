# Runbook: everything pending on your side

**PowerShell.** Every command here is PowerShell, because that is your shell.
An earlier version of this file was bash and the variables silently expanded to
nothing, which is why `cast balance $ALIVE_ADDR` reported a missing argument.

In PowerShell you set an environment variable with `$env:NAME = "value"` and
read it back the same way. There is no `export`.

Roughly 40 minutes, most of it waiting for a deploy.

---

## 0. The wallet question, answered

**Use a disposable wallet. It is the right choice here, not a shortcut.**

Measured on chain, at 0.05 gwei:

| | |
|---|---|
| One `register()` | 191,934 gas, **0.0000096 BNB** |
| Three registrations | **0.000029 BNB** |
| Whole demo, 6 transactions | **0.000058 BNB** |

Fund it with **0.01 BNB** and you have a 170x margin on the entire exercise.
The maximum loss if that key leaks is whatever you put in it.

**The caveat, corrected.** ERC-8004 agents are ERC-721 tokens owned by the
registering address. Losing the key means losing control of those three agents.
It does **not** mean a wrong URL is permanent: `setAgentURI(uint256,string)`
exists on the registry and the owner can update a registration later. So a bad
deploy is recoverable for one more transaction. Still deploy first, but you are
not one typo away from a dead agent forever.

Do not use a wallet holding anything you care about. Nothing here needs one.

---

## 1. Install the tooling

You have `cast` already. You need `flyctl`, and nothing else:

```powershell
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

Then restart PowerShell so the new PATH is picked up, and check:

```powershell
fly version
```

Fly builds remotely, so you do **not** need Docker locally. You will need a Fly
account, and Fly asks for a payment method even on the free allowance.

*If you would rather not: any host giving a public HTTPS URL with no cold
starts works. Render and Railway both need a GitHub remote, which this repo does
not have yet.*

---

## 2. Create and fund the wallet

```powershell
cast wallet new
```

Save the printed key somewhere you will still have next week, then:

```powershell
$env:ALIVE_ADDR = "0xYourNewAddress"
$env:ALIVE_KEY  = "0xYourPrivateKey"
$env:ETH_RPC_URL = "https://bsc.rpc.blxrbdn.com"
```

Send **0.01 BNB** to that address, then confirm:

```powershell
cast balance $env:ALIVE_ADDR --ether
```

> Never paste a private key into a chat, a web page, an issue, or a commit.
> `.env` is gitignored here and no code in this repo reads a key.

---

## 3. Deploy the agent service

```powershell
fly launch --no-deploy
fly secrets set AGENT_BASE_URL=https://alive-md-agents.fly.dev
fly deploy
```

`fly launch` may propose a different app name if that one is taken. Whatever it
picks, use the same name in the secret and everywhere below.

`fly.toml` is already in the repo and pinned to `min_machines_running = 1`,
deliberately: our own verifier probes this service, and a cold start is recorded
as `unreachable`, which is exactly the verdict we publish about other people's
agents.

Check it is genuinely up:

```powershell
curl.exe -s https://alive-md-agents.fly.dev/
curl.exe -s https://alive-md-agents.fly.dev/agents/bsc-address-inspector/registration.json
```

Use `curl.exe`, not `curl`: in PowerShell, `curl` is an alias for
`Invoke-WebRequest` and takes different arguments.

Both must return JSON before you continue.

---

## 4. Register the three agents

Generate the registration files and calldata:

```powershell
node --experimental-strip-types packages/agents/src/seed.ts --base https://alive-md-agents.fly.dev
```

It refuses to emit real calldata against a localhost URL, so it will tell you if
step 3 did not happen.

Then one transaction per agent:

```powershell
foreach ($slug in "bsc-address-inspector","endpoint-liveness","erc8004-registration-auditor") {
  cast send 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 `
    "register(string)" `
    "https://alive-md-agents.fly.dev/agents/$slug/registration.json" `
    --private-key $env:ALIVE_KEY --rpc-url $env:ETH_RPC_URL
}
```

Note the backticks: that is PowerShell's line continuation, not bash's
backslash.

**Record the three agent ids.** Each receipt contains the new token id in its
logs. To find the highest ids now owned by you:

```powershell
node --experimental-strip-types indexer/src/find-mine.ts $env:ALIVE_ADDR
```

---

## 5. Mark them as ours

Non-negotiable, and an honesty requirement rather than a feature. The catalog
argues that directories hide their own composition. Unlabelled first-party
supply, found by a judge, hands them our own argument.

```powershell
node --experimental-strip-types packages/agents/src/seed.ts --claim <agentId> bsc-address-inspector
```

Repeat for the other two. `first_party` is only ever set by this command, so a
re-sweep cannot silently unmark them.

---

## 6. Get them listed immediately

No waiting for a sweep:

```powershell
foreach ($id in "<id1>","<id2>","<id3>") {
  curl.exe -s -X POST "http://localhost:8787/api/agents/$id/verify"
}
```

You want `"verifiedClass": "task-interface"` and `"listed": true`.

Anything else is the real answer and worth reading. `no-interface` means the
registration declares no callable endpoint. `dead` means the host answered with
an error. `unreachable` usually means the deploy is not public yet.

---

## 7. Get some U

Escrow settles in U and nothing else. That is immutable on the Commerce kernel,
not our choice. Our agents charge 0.2, 0.1 and 0.5 U, so **2 U is comfortable**.

The liquid venue is the PancakeSwap **V3** pool:

- `0xA0909f81785f87f3e79309F0E73A7d82208094E4`, U/USDT, 0.01% fee
- Depth as measured: about 11M U against 10M USDT

Swap a few USDT for U with this wallet connected, then:

```powershell
cast call 0xcE24439F2D9C6a2289F741120FE202248B666666 "balanceOf(address)(uint256)" $env:ALIVE_ADDR --rpc-url $env:ETH_RPC_URL
```

> The **V2** pair holds about 1.3 cents and looks like proof U is untradeable.
> It is an abandoned shell. Use V3.

---

## 8. Run one real hire, before recording anything

The step that matters most. Every part of the hire flow has been verified
against jobs other people created. **No job has ever been created by this
system.**

```powershell
npm run api    # terminal 1
npm run web    # terminal 2
```

Then in the browser: Browse, open one of your three agents, Hire, describe a
task, **Ask this agent what it charges**, accept the quote, sign three
transactions.

Expect something to break the first time. That is exactly why this happens
before the camera is on.

---

## Order of dependencies

```
tooling ──> wallet ──> deploy ──> register ──> claim ──> verify ──> listed
                                                             │
                                     get U ──────────────────┴──> first real hire
```

---

## PowerShell gotchas in this repo

- `$env:NAME = "value"` to set, `$env:NAME` to read. No `export`.
- `curl.exe`, not `curl`. Bare `curl` is `Invoke-WebRequest`.
- Backtick for line continuation, not backslash.
- `foreach ($x in "a","b") { }`, not `for x in a b; do done`.

---

## What is on my side, not yours

- Verifier cron, so listings stay current without anyone asking
- A "list your agent" screen, so step 6 does not need curl
- Job actions on the job screen
- Renaming the project to ALIVE.md across the UI and docs

---

## If something goes wrong

**`fly` not recognised after install.** Restart PowerShell. The installer edits
PATH and the current session does not see it.

**`register()` reverts.** Usually the URI exceeds the on-chain description cap.
Keep it short.

**Verify returns `unreachable`.** Our SSRF guard refuses private and loopback
addresses. If your host resolves to one, that is the cause and it is working as
designed.

**Verify returns `html`.** The endpoint answered with a web page rather than
JSON, usually a platform holding page in front of the service.

**Wrong URL registered.** Not fatal. Fix it with one transaction:

```powershell
cast send 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 `
  "setAgentURI(uint256,string)" <agentId> "https://correct-url/registration.json" `
  --private-key $env:ALIVE_KEY --rpc-url $env:ETH_RPC_URL
```
