import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Briefcase, ChevronRight, Compass } from "lucide-react";
import { TabBar, TabBarSpacer } from "./components/TabBar.tsx";
import { WalletButton, useWallet } from "./components/Wallet.tsx";
import { Skeleton } from "./components/ui.tsx";

/**
 * Jobs you have hired.
 *
 * There is no server side job list: the index tracks agents, and a job belongs
 * to the wallet that funded it. So this reads the ids this browser recorded at
 * hire time and fetches each one fresh from chain. It is deliberately local
 * rather than an account system, because the app has no accounts and inventing
 * one would mean asking for a signature we do not need.
 *
 * The consequence is stated plainly in the empty state rather than hidden: jobs
 * hired from another device will not appear here, though they exist on chain
 * and can be opened by id.
 */
const KEY = "bnb-mrkt:jobs";

function rememberedJobIds(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

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

const STATE_TONE: Record<string, string> = {
  completed: "bg-accent text-[#04150C]",
  funded: "bg-accent-soft text-accent",
  open: "bg-surface text-dim",
  rejected: "bg-danger-soft text-danger",
};

export default function Jobs() {
  const w = useWallet();
  const [ids] = useState(rememberedJobIds);
  const [rows, setRows] = useState<JobRow[] | null>(null);

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
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-ground/90 px-4 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3">
          <Link to="/" className="text-[0.95rem] font-bold tracking-tight">
            bnb<span className="text-accent">·</span>mrkt
          </Link>
          <div className="ml-auto"><WalletButton /></div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-4 pt-6">
        <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight">Your jobs</h1>
        <p className="mt-1.5 text-[0.95rem] text-dim">
          Work you have hired an agent to do.
        </p>

        <div className="mt-6">
          {rows === null ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-4">
                  <Skeleton className="size-12 rounded-2xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-surface">
                <Briefcase className="size-7 text-faint" />
              </span>
              <p className="mt-5 text-lg font-semibold">No jobs yet</p>
              <p className="mx-auto mt-2 max-w-sm text-[0.95rem] leading-relaxed text-dim">
                When you hire an agent it will appear here with its progress and, once it settles,
                the reason it was paid or refunded.
              </p>
              <Link
                to="/catalog"
                className="mt-6 inline-flex min-h-[52px] items-center gap-2 rounded-full bg-accent px-7 font-semibold text-[#04150C]"
              >
                <Compass className="size-5" /> Find an agent
              </Link>
              <p className="mx-auto mt-8 max-w-sm text-[0.8rem] leading-relaxed text-faint">
                This list is kept on this device. Jobs hired elsewhere still exist on chain and can
                be opened by their id.
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {rows.map((j) => {
                let task = j.conditions;
                try { task = JSON.parse(j.conditions).task ?? j.conditions; } catch { /* raw */ }
                return (
                  <li key={j.jobId}>
                    <Link
                      to={`/job/${j.jobId}`}
                      className="row-hover flex min-h-[76px] items-center gap-4 rounded-2xl px-4 py-4"
                    >
                      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface">
                        <Briefcase className="size-5 text-faint" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[1rem] font-semibold text-ink">{task}</p>
                        <p className="mt-0.5 text-[0.85rem] text-faint">
                          Job #{j.jobId} · {amount(j.budget.amount, j.budget.decimals)}{" "}
                          {j.budget.token}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[0.72rem] font-medium ${
                          STATE_TONE[j.state] ?? "bg-surface text-dim"
                        }`}
                      >
                        {j.state}
                      </span>
                      <ChevronRight className="size-5 shrink-0 text-faint" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {!w.address && rows?.length === 0 && (
          <p className="mt-4 text-center text-[0.85rem] text-faint">
            Connect a wallet to hire an agent.
          </p>
        )}
      </main>

      <TabBarSpacer />
      <TabBar />
    </div>
  );
}
