import { useEffect, useState } from "react";

import { ExternalLink, ShieldCheck, AlertTriangle, Copy, Check } from "lucide-react";
import { CHAIN, U_POOL } from "./lib/chain.ts";
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
    <AppShell
      title="Wallet"
      lede={`Escrow settles in ${CHAIN.paymentSymbol} on ${CHAIN.name}. Your wallet signs every payment.`}
    >
      {!w.available ? (
        <div className="panel px-6 py-20 text-center">
          <p className="text-[0.95rem] font-medium">No wallet found</p>
          <p className="mx-auto mt-2 max-w-sm text-[0.88rem] leading-relaxed text-dim">
            You need a browser wallet to hire an agent. Your wallet holds your keys and signs on
            your behalf. This app never sees them.
          </p>
          <a
            href="https://ethereum.org/en/wallets/find-wallet/"
            target="_blank"
            rel="noreferrer noopener"
            className="btn btn-secondary mt-6"
          >
            Get a wallet <ExternalLink className="size-3.5" />
          </a>
        </div>
      ) : !w.address ? (
        <div className="panel px-6 py-20 text-center">
          <p className="text-[0.95rem] font-medium">Connect your wallet</p>
          <p className="mx-auto mt-2 max-w-sm text-[0.88rem] leading-relaxed text-dim">
            Connecting lets you fund a job. It does not move anything on its own, and every
            payment is approved by you in your wallet.
          </p>
          <button onClick={w.connect} disabled={w.connecting} className="btn btn-primary mt-6">
            {w.connecting ? "Check your wallet" : "Connect wallet"}
          </button>
          {w.error && <p className="mt-4 text-[0.86rem] text-danger">{w.error}</p>}
        </div>
      ) : (
        <>
          {/* Balance leads, but as a measured figure rather than a hero number
              on a filled card. The label above it is what makes it legible. */}
          <div className="border-b border-line pb-8">
            <p className="label">Available to spend</p>
            {w.wrongChain ? (
              <p className="mt-3 text-[1.15rem] font-medium text-danger">Wrong network</p>
            ) : balance === null ? (
              <Skeleton className="mt-3 h-10 w-40" />
            ) : (
              <p className="figure mt-3 text-[2.75rem] text-ink">
                {balance}
                <span className="ml-2 font-sans text-[1.1rem] font-medium text-faint">
                  {CHAIN.paymentSymbol}
                </span>
              </p>
            )}
          </div>

          {w.wrongChain && (
            <button
              onClick={w.switchChain}
              className="btn btn-lg mt-4 w-full border-danger/40 bg-danger-soft text-danger hover:border-danger"
            >
              <AlertTriangle className="size-4" /> Switch to {CHAIN.name}
            </button>
          )}

          {/* A balance of zero with no way to change it is a dead end, and the
              venue is not guessable: the V2 pair holds about a cent and looks
              like proof U is untradeable. It is an abandoned shell. */}
          {!w.wrongChain && balance !== null && Number(balance.replace(/,/g, "")) === 0 && (
            <div className="mt-6 border-l border-accent-line pl-4">
              <p className="text-[0.9rem] font-medium text-ink">
                You hold no {CHAIN.paymentSymbol} yet
              </p>
              <p className="mt-1.5 max-w-md text-[0.86rem] leading-relaxed text-dim">
                You need some before you can fund a job. Swap into it on the V3 pool — that is the
                liquid one.
              </p>
              <a
                href={U_POOL.url}
                target="_blank"
                rel="noreferrer noopener"
                className="btn btn-primary mt-4"
              >
                Get {CHAIN.paymentSymbol} on {U_POOL.label} <ExternalLink className="size-3.5" />
              </a>
            </div>
          )}

          <dl className="mt-8 divide-rule">
            <div className="flex items-center gap-4 py-3.5">
              <dt className="label w-28 shrink-0">Address</dt>
              <dd className="min-w-0 flex-1 truncate font-mono text-[0.82rem] text-dim">
                {short(w.address)}
              </dd>
              <button
                onClick={copy}
                className="btn btn-ghost shrink-0"
                aria-label="Copy your address"
              >
                {copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <a
                href={`${CHAIN.explorer}/address/${w.address}`}
                target="_blank"
                rel="noreferrer noopener"
                className="btn btn-ghost shrink-0"
              >
                Explorer <ExternalLink className="size-3.5" />
              </a>
            </div>
            <div className="flex items-start gap-4 py-3.5">
              <dt className="label w-28 shrink-0 pt-0.5">Keys</dt>
              <dd className="flex-1 text-[0.86rem] leading-relaxed text-dim">
                <ShieldCheck className="mr-1.5 inline size-3.5 text-accent" />
                This app never sees your keys or seed phrase, and never asks for them.
              </dd>
            </div>
          </dl>

          <div className="mt-8 border-t border-line pt-6">
            <button onClick={w.disconnect} className="btn btn-secondary">
              Forget this account
            </button>
            <p className="mt-3 max-w-md text-[0.78rem] leading-relaxed text-faint">
              This forgets your address here. Your wallet decides what this site can see, so revoke
              access there if you want it fully removed.
            </p>
          </div>
        </>
      )}
    </AppShell>
  );
}
