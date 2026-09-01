import { useEffect, useState } from "react";

import { Wallet2, ExternalLink, ShieldCheck, AlertTriangle, Copy, Check } from "lucide-react";
import { CHAIN } from "./lib/chain.ts";
import { short } from "./lib/api.ts";
import { AppShell } from "./components/AppShell.tsx";
import { useWallet } from "./components/Wallet.tsx";
import { Skeleton } from "./components/ui.tsx";

/**
 * Wallet screen.
 *
 * A consumer finance app leads with the balance, so that is the first and
 * largest thing here. Everything else is secondary.
 *
 * The balance is read straight from the token contract over the injected
 * provider. This app never sees a private key or a seed phrase, never asks for
 * one, and cannot move funds: every transfer is a request the wallet shows the
 * user and they approve in their own interface.
 */
const BALANCE_OF = "0x70a08231";

function formatUnits(hex: string, decimals: number) {
  try {
    const v = BigInt(hex);
    const whole = v / 10n ** BigInt(decimals);
    const frac = (v % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").slice(0, 2);
    return `${whole.toLocaleString("en-US")}.${frac}`;
  } catch { return "0.00"; }
}

export default function WalletScreen() {
  const w = useWallet();
  const [balance, setBalance] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    if (!w.address || w.wrongChain || !window.ethereum) { setBalance(null); return; }
    (async () => {
      try {
        const data = BALANCE_OF + w.address!.slice(2).padStart(64, "0");
        const hex = (await window.ethereum!.request({
          method: "eth_call",
          params: [{ to: CHAIN.paymentToken, data }, "latest"],
        })) as string;
        if (live) setBalance(formatUnits(hex, CHAIN.paymentDecimals));
      } catch {
        // Rule 0 at the edge: a failed read is not a zero balance.
        if (live) setBalance(null);
      }
    })();
    return () => { live = false; };
  }, [w.address, w.wrongChain]);

  const copy = async () => {
    if (!w.address) return;
    try {
      await navigator.clipboard.writeText(w.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  };

  return (
    <AppShell title="Wallet">
      <div className="mt-6">
        {!w.available ? (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-surface">
              <Wallet2 className="size-7 text-faint" />
            </span>
            <p className="mt-5 text-lg font-semibold">No wallet found</p>
            <p className="mx-auto mt-2 max-w-sm text-[0.95rem] leading-relaxed text-dim">
              You need a browser wallet to hire an agent. Your wallet holds your keys and signs on
              your behalf. This app never sees them.
            </p>
            <a
              href="https://ethereum.org/en/wallets/find-wallet/"
              target="_blank"
              rel="noreferrer noopener"
              className="mt-6 inline-flex min-h-[52px] items-center gap-2 rounded-full bg-accent px-7 font-semibold text-[#04150C]"
            >
              Get a wallet <ExternalLink className="size-4" />
            </a>
          </div>
        ) : !w.address ? (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-accent-soft">
              <Wallet2 className="size-7 text-accent" />
            </span>
            <p className="mt-5 text-lg font-semibold">Connect your wallet</p>
            <p className="mx-auto mt-2 max-w-sm text-[0.95rem] leading-relaxed text-dim">
              Connecting lets you fund a job. It does not move anything on its own, and every
              payment is approved by you in your wallet.
            </p>
            <button
              onClick={w.connect}
              disabled={w.connecting}
              className="mt-6 min-h-[52px] rounded-full bg-accent px-8 font-semibold text-[#04150C] disabled:opacity-60"
            >
              {w.connecting ? "Check your wallet" : "Connect wallet"}
            </button>
            {w.error && <p className="mt-4 text-[0.88rem] text-danger">{w.error}</p>}
          </div>
        ) : (
          <>
            {/* Balance first and largest, the way a finance app opens. */}
            <div className="rounded-3xl border border-line bg-surface px-6 py-8 text-center">
              <p className="text-[0.85rem] text-dim">Available to spend</p>
              {w.wrongChain ? (
                <p className="mt-3 text-[1.1rem] font-medium text-danger">Wrong network</p>
              ) : balance === null ? (
                <Skeleton className="mx-auto mt-4 h-12 w-40" />
              ) : (
                <p className="mt-2 text-[3rem] font-bold leading-none tracking-tight tabular-nums">
                  {balance}
                  <span className="ml-2 text-[1.25rem] font-semibold text-dim">
                    {CHAIN.paymentSymbol}
                  </span>
                </p>
              )}
              <p className="mt-3 text-[0.82rem] text-faint">
                Escrow settles in {CHAIN.paymentSymbol}. That is fixed by the contract, not by
                us.
              </p>
            </div>

            {w.wrongChain && (
              <button
                onClick={w.switchChain}
                className="mt-3 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-danger-soft font-semibold text-danger"
              >
                <AlertTriangle className="size-5" /> Switch to {CHAIN.name}
              </button>
            )}

            <div className="mt-3 space-y-1">
              <button
                onClick={copy}
                className="row-hover flex min-h-[64px] w-full items-center gap-4 rounded-2xl px-4 text-left"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface">
                  {copied ? <Check className="size-5 text-accent" /> : <Copy className="size-5 text-faint" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.95rem] font-medium">
                    {copied ? "Copied" : "Your address"}
                  </span>
                  <span className="block truncate text-[0.82rem] text-faint">{short(w.address)}</span>
                </span>
              </button>

              <a
                href={`${CHAIN.explorer}/address/${w.address}`}
                target="_blank"
                rel="noreferrer noopener"
                className="row-hover flex min-h-[64px] items-center gap-4 rounded-2xl px-4"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface">
                  <ExternalLink className="size-5 text-faint" />
                </span>
                <span className="flex-1 text-[0.95rem] font-medium">View on explorer</span>
              </a>

              <div className="flex min-h-[64px] items-center gap-4 rounded-2xl px-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent-soft">
                  <ShieldCheck className="size-5 text-accent" />
                </span>
                <span className="flex-1 text-[0.88rem] leading-relaxed text-dim">
                  This app never sees your keys or seed phrase, and never asks for them.
                </span>
              </div>
            </div>

            <button
              onClick={w.disconnect}
              className="mt-6 min-h-[52px] w-full rounded-full border border-line font-medium text-dim"
            >
              Disconnect
            </button>
            <p className="mt-3 text-center text-[0.78rem] leading-relaxed text-faint">
              This forgets your address here. Your wallet decides what this site can see, so revoke
              access there if you want it fully removed.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
