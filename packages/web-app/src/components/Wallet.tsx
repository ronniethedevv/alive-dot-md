import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Wallet as WalletIcon, LogOut, AlertTriangle } from "lucide-react";
import { CHAIN } from "../lib/chain.ts";
import { short } from "../lib/api.ts";

/**
 * Wallet connection over the browser's injected EIP-1193 provider.
 *
 * The wallet holds the keys and signs. This app never sees, stores, requests or
 * transmits a private key or seed phrase, and it never asks the user to type
 * one. Everything here is a request the wallet shows the user and they approve
 * in their own interface.
 */

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, cb: (...a: never[]) => void): void;
  removeListener?(event: string, cb: (...a: never[]) => void): void;
}
declare global {
  interface Window { ethereum?: Eip1193 }
}

interface WalletState {
  available: boolean;
  address: string | null;
  chainId: number | null;
  wrongChain: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);
export const useWallet = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside WalletProvider");
  return v;
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const eth = typeof window !== "undefined" ? window.ethereum : undefined;
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reflect an existing connection without prompting. eth_accounts asks the
  // provider what is already authorised; it never opens a dialog.
  useEffect(() => {
    if (!eth) return;
    let live = true;
    (async () => {
      try {
        const accs = (await eth.request({ method: "eth_accounts" })) as string[];
        const cid = (await eth.request({ method: "eth_chainId" })) as string;
        if (!live) return;
        if (accs?.[0]) setAddress(accs[0]);
        setChainId(Number.parseInt(cid, 16));
      } catch { /* provider refused to answer, stay disconnected */ }
    })();

    const onAccounts = (...a: never[]) => setAddress(((a[0] as unknown as string[]) ?? [])[0] ?? null);
    const onChain = (...a: never[]) => setChainId(Number.parseInt(a[0] as unknown as string, 16));
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      live = false;
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [eth]);

  const connect = useCallback(async () => {
    if (!eth) return;
    setConnecting(true);
    setError(null);
    try {
      const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accs?.[0] ?? null);
      const cid = (await eth.request({ method: "eth_chainId" })) as string;
      setChainId(Number.parseInt(cid, 16));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/user rejected|denied/i.test(msg) ? "Connection was declined in your wallet." : msg);
    } finally {
      setConnecting(false);
    }
  }, [eth]);

  const switchChain = useCallback(async () => {
    if (!eth) return;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.hexId }] });
    } catch (e) {
      // 4902: the chain is unknown to the wallet, so offer to add it.
      if ((e as { code?: number })?.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: CHAIN.hexId,
            chainName: CHAIN.name,
            nativeCurrency: CHAIN.currency,
            rpcUrls: [CHAIN.rpc],
            blockExplorerUrls: [CHAIN.explorer],
          }],
        });
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [eth]);

  /**
   * Local disconnect only. A dapp cannot revoke its own permission; the wallet
   * owns that. Saying "disconnected" while the site could still read the
   * account would be a lie, so the copy says what actually happened.
   */
  const disconnect = useCallback(() => { setAddress(null); setError(null); }, []);

  const value = useMemo<WalletState>(() => ({
    available: !!eth,
    address,
    chainId,
    wrongChain: address !== null && chainId !== null && chainId !== CHAIN.id,
    connecting,
    error,
    connect,
    disconnect,
    switchChain,
  }), [eth, address, chainId, connecting, error, connect, disconnect, switchChain]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Compact connect control for the top bar. */
export function WalletButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The account menu was mouse only: no Escape, no dismiss on outside click,
  // and focus was never returned to the trigger, so a keyboard user could open
  // it and have no way back out.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    // Move focus into the menu so the next Tab lands inside it, not past it.
    menuRef.current?.querySelector("button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (!w.available) {
    return (
      <a
        href="https://ethereum.org/en/wallets/find-wallet/"
        target="_blank"
        rel="noreferrer noopener"
        className="btn btn-secondary"
      >
        <WalletIcon className="size-4" /> Get a wallet
      </a>
    );
  }

  if (!w.address) {
    return (
      <button
        onClick={w.connect}
        disabled={w.connecting}
        className="btn btn-primary"
      >
        <WalletIcon className="size-4" />
        <span aria-live="polite">{w.connecting ? "Check your wallet" : "Connect wallet"}</span>
      </button>
    );
  }

  if (w.wrongChain) {
    return (
      <button
        onClick={w.switchChain}
        className="btn border-danger/40 bg-danger-soft text-danger hover:border-danger"
      >
        <AlertTriangle className="size-4" /> Switch to {CHAIN.name}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Connected account ${w.address}. Account menu.`}
        className="inline-flex min-h-[2.5rem] items-center gap-2 rounded-lg border border-line px-3 font-mono text-[0.76rem] text-dim transition-colors hover:border-line-2 hover:text-ink"
      >
        <span className="size-1.5 rounded-full bg-accent" aria-hidden /> {short(w.address)}
      </button>
      {open && (
        <div ref={menuRef} role="menu" className="panel-solid absolute right-0 z-50 mt-2 w-64 p-1.5">
          <p className="break-all px-2.5 py-2 font-mono text-[0.68rem] text-faint">{w.address}</p>
          <button
            role="menuitem"
            onClick={() => { w.disconnect(); setOpen(false); triggerRef.current?.focus(); }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[0.86rem] text-dim transition-colors hover:bg-raised hover:text-ink"
          >
            <LogOut className="size-4" /> Forget this account
          </button>
          <p className="px-2.5 pb-1.5 pt-2 text-[0.68rem] leading-relaxed text-faint">
            This clears the account from this site only. Your wallet decides what it shares, so
            revoke access there if you want it gone entirely.
          </p>
        </div>
      )}
    </div>
  );
}
