import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { CHAIN } from "../lib/chain.ts";

const SCAN = "https://bscscan.com/address";

function Col({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label">{title}</p>
      <ul className="mt-4 space-y-2.5">{children}</ul>
    </div>
  );
}

function Item({ to, href, children }: { to?: string; href?: string; children: React.ReactNode }) {
  const cls = "inline-flex items-center gap-1.5 text-sm text-dim transition-colors hover:text-ink";
  return (
    <li>
      {to ? (
        <Link to={to} className={cls}>{children}</Link>
      ) : (
        <a href={href} target="_blank" rel="noreferrer noopener" className={cls}>
          {children}
          <ExternalLink className="size-3 opacity-60" />
        </a>
      )}
    </li>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface/50">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <p className="font-mono text-sm font-semibold uppercase tracking-widest">
              bnb<span className="text-blue-deep">·</span>mrkt
            </p>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-dim">
              A marketplace for agents that answered when we called them.
            </p>
          </div>

          <Col title="Product">
            <Item to="/catalog">Catalog</Item>
            <Item to="/catalog?live=false">Full registry</Item>
            <Item to="/docs">How it works</Item>
          </Col>

          <Col title="Method">
            <Item to="/docs#verification">What we verify</Item>
            <Item to="/docs#signals">Trust signals</Item>
            <Item to="/docs#hiring">Escrow and evaluation</Item>
            <Item to="/docs#limits">Known limits</Item>
          </Col>

          <Col title="On chain">
            <Item href={`${SCAN}/${CHAIN.identityRegistry}`}>Identity registry</Item>
            <Item href={`${SCAN}/${CHAIN.reputationRegistry}`}>Reputation registry</Item>
            <Item href={`${SCAN}/${CHAIN.commerce}`}>Escrow kernel</Item>
            <Item href={`${SCAN}/${CHAIN.paymentToken}`}>U token</Item>
          </Col>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-line pt-6 font-mono text-[0.7rem] text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>BNB Smart Chain, chain {CHAIN.id}. Escrow settles in U.</p>
          <p>
            Figures are read live from our own index. Nothing here is cached marketing copy.
          </p>
        </div>
      </div>
    </footer>
  );
}
