// Which agents does this address own?
//
//   node --experimental-strip-types indexer/src/find-mine.ts 0xYourAddress
//
// After registering you need the new token ids, and `register()` returns them
// in a receipt log rather than anywhere convenient. Rather than parse three
// receipts, this walks back from the highest minted id and reports every agent
// owned by the address, which is what you actually wanted to know.

import { ERC8004 } from "../../packages/shared/src/chain.ts";
import { SEL, encodeUint, decodeString } from "./abi.ts";
import { Rpc } from "./rpc.ts";

const owner = (process.argv[2] ?? "").toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(owner)) {
  console.error("usage: find-mine.ts 0xYourAddress");
  process.exit(1);
}

const rpc = new Rpc({ perEndpoint: 1 });

/** Highest minted id. ownerOf reverts past the end, which is how we find it. */
async function maxId(): Promise<number> {
  const exists = async (id: number) => {
    const [r] = await rpc.ethCallDetailed([
      { to: ERC8004.identityRegistry, data: encodeUint(SEL.ownerOf, id) },
    ]);
    return r?.kind === "ok";
  };
  let lo = 1, hi = 500_000;
  if (await exists(hi)) return hi;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await exists(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

const SCAN = Number(process.env.SCAN_BACK ?? 3000);

const top = await maxId();
console.log(`highest minted agent id: ${top.toLocaleString()}`);
console.log(`scanning back ${SCAN.toLocaleString()} ids for ${owner}\n`);

const ids = Array.from({ length: SCAN }, (_, i) => top - i).filter((n) => n > 0);
const found: { id: number; uri: string }[] = [];

for (let i = 0; i < ids.length; i += 50) {
  const chunk = ids.slice(i, i + 50);
  const res = await rpc.ethCallDetailed(chunk.map((id) => ({
    to: ERC8004.identityRegistry, data: encodeUint(SEL.ownerOf, id),
  })));
  chunk.forEach((id, j) => {
    const r = res[j];
    if (r?.kind === "ok" && r.data.slice(-40).toLowerCase() === owner.slice(2)) {
      found.push({ id, uri: "" });
    }
  });
  if (found.length >= 25) break;
  process.stdout.write(`\r  checked ${Math.min(i + 50, ids.length)}/${ids.length}`);
}
process.stdout.write("\r".padEnd(40) + "\r");

if (found.length === 0) {
  console.log("No agents found for that address in the scanned range.");
  console.log("If you registered a while ago, widen it: SCAN_BACK=20000");
  process.exit(0);
}

// Fetch each URI so the output is identifiable rather than a list of numbers.
const uris = await rpc.ethCallDetailed(found.map((f) => ({
  to: ERC8004.identityRegistry, data: encodeUint(SEL.tokenURI, f.id),
})));
found.forEach((f, i) => {
  const r = uris[i];
  f.uri = (r?.kind === "ok" ? decodeString(r.data) : null) ?? "";
});

console.log(`${found.length} agent(s) owned by ${owner}:\n`);
for (const f of found.sort((a, b) => a.id - b.id)) {
  // Name the slug from the URI where we can, since that is what --claim wants.
  const slug = f.uri.match(/\/agents\/([a-z0-9-]+)\//)?.[1] ?? "";
  console.log(`  agent id ${String(f.id).padEnd(8)} ${slug || f.uri.slice(0, 60)}`);
  if (slug) {
    console.log(`    node --experimental-strip-types packages/agents/src/seed.ts --claim ${f.id} ${slug}`);
  }
}
