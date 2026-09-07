import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Compass, Search } from "lucide-react";
import { AppShell } from "./components/AppShell.tsx";
import { useWallet } from "./components/Wallet.tsx";
import { Skeleton } from "./components/ui.tsx";
import { rememberedJobIds } from "./lib/jobs.ts";

/**
 * Jobs you have hired.
 *
 * There is no server side job list: the index tracks agents, and a job belongs
 * to the wallet that funded it. So this reads the ids this browser recorded at
 * hire time and fetches each one fresh from chain. It is deliberately local
 * rather than an account system, because the app has no accounts and inventing
 * one would mean asking for a signature we do not need.
 *
 * The key lives in lib/jobs.ts and nowhere else. It used to be written here as
 * a literal that did not match the one Hire.tsx wrote, so this list could never
 * show anything - including the job someone had just funded.
 *
 * The remaining consequence is stated plainly rather than hidden: historical
 * `eth_getLogs` is refused by every free BSC endpoint we tested, so there is no
 * way to ask the chain which jobs an address created. A job hired on another
 * device still exists, and the field at the bottom of this screen opens it by
 * number.
 */

interface JobRow {
  jobId: string;
  state: string;
  conditions: string;
  budget: { amount: string; token: string; decimals: number };
}

const amount = (a: string, d: number) => {
  try {
    const v = BigInt(a); const w = v / 10n ** BigInt(d);
    const f = (v % 10n ** BigInt(d)).toString().padStart(d, "0").replace(/0+$/, "");
    return f ? `${w}.${f.slice(0, 4)}` : w.toString();
  } catch { return a; }
};

/** State is a fact about the job, so it reads as a status chip, not a colour. */
const STATE_PILL: Record<string, string> = {
  completed: "pill-verified",
  funded: "pill-soft",
  open: "pill-claim",
  rejected: "pill-danger",
};

export default function Jobs() {
  const w = useWallet();
  const nav = useNavigate();
  const [ids] = useState(rememberedJobIds);
  const [rows, setRows] = useState<JobRow[] | null>(null);
  const [openId, setOpenId] = useState("");

  useEffect(() => {
    let live = true;
    if (ids.length === 0) { setRows([]); return; }
    (async () => {
      const out = await Promise.all(ids.map(async (id) => {
        try {
          const r = await fetch(`/api/jobs/${id}`);
          const b = await r.json();
          return r.ok && !b.error ? (b as JobRow) : null;
        } catch { return null; }
      }));
      if (live) setRows(out.filter(Boolean) as JobRow[]);
    })();
    return () => { live = false; };
  }, [ids]);

  return (
    <AppShell title="Your jobs" lede="Work you have hired an agent to do.">
      <div className="panel overflow-hidden">
        {rows === null ? (
          <div className="divide-rule">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-5 w-16 rounded-md" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-20 text-center">
            <p className="text-[0.95rem] font-medium">No jobs yet</p>
            <p className="mx-auto mt-2 max-w-sm text-[0.88rem] leading-relaxed text-dim">
              When you hire an agent it will appear here with its progress and, once it settles,
              the reason it was paid or refunded.
            </p>
            <Link to="/catalog" className="btn btn-secondary mt-6">
              <Compass className="size-4" /> Find an agent
            </Link>
          </div>
        ) : (
          <ul className="divide-rule">
            {rows.map((j) => {
              let task = j.conditions;
              try { task = JSON.parse(j.conditions).task ?? j.conditions; } catch { /* raw */ }
              return (
                <li key={j.jobId}>
                  <Link
                    to={`/job/${j.jobId}`}
                    className="row-hover group flex items-center gap-4 px-4 py-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.95rem] font-medium text-ink">{task}</p>
                      <p className="meta mt-1">
                        #{j.jobId}  ·  {amount(j.budget.amount, j.budget.decimals)} {j.budget.token}
                      </p>
                    </div>
                    <span className={`pill shrink-0 ${STATE_PILL[j.state] ?? "pill-mute"}`}>
                      {j.state}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-faint group-hover:text-dim" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* The escape hatch for the device-local limit above. A job hired on a
          phone is invisible on a laptop, and saying so without offering a way
          through would just be an apology. */}
      <form
        className="mt-8 border-t border-line pt-6"
        onSubmit={(e) => {
          e.preventDefault();
          const id = openId.trim();
          if (/^\d+$/.test(id)) nav(`/job/${id}`);
        }}
      >
        <label className="block">
          <span className="label">Open a job by number</span>
          <span className="mt-2 block max-w-xl text-[0.85rem] leading-relaxed text-dim">
            This list is kept on this device. A job hired somewhere else still exists on chain —
            open it here and it works exactly the same, including settling it.
          </span>
          <div className="mt-3 flex max-w-sm items-center gap-2">
            <div className="field flex flex-1 items-center gap-2.5 px-3">
              <Search className="size-4 shrink-0 text-faint" />
              <input
                value={openId}
                onChange={(e) => setOpenId(e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                placeholder="56789"
                aria-label="Job number"
                className="min-h-[40px] w-full bg-transparent font-mono text-[0.88rem] outline-none placeholder:text-faint"
              />
            </div>
            <button
              type="submit"
              disabled={!/^\d+$/.test(openId.trim())}
              className="btn btn-secondary"
            >
              Open
            </button>
          </div>
        </label>
      </form>

      {!w.address && rows?.length === 0 && (
        <p className="mt-6 text-[0.84rem] text-faint">Connect a wallet to hire an agent.</p>
      )}
    </AppShell>
  );
}
