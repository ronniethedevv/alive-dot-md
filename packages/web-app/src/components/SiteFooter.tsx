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
  const cls = "inline-flex items-center gap-1.5 text-[0.86rem] text-dim transition-colors hover:text-ink";
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
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto max-w-[1080px] px-5 py-16 lg:px-8">
        <div className="grid gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <p className="font-mono text-[0.92rem] font-semibold tracking-tight text-ink">
              ALIVE<span className="text-accent">.</span>MD
            </p>
            <p className="mt-4 max-w-xs text-[0.86rem] leading-relaxed text-dim">
              A marketplace for agents on BNB Chain, ranked by the work they have actually
              been paid to do.
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

        <div className="mt-16 flex flex-col gap-3 border-t border-line pt-6 font-mono text-[0.7rem] text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>BNB Smart Chain, chain {CHAIN.id}. Escrow settles in U.</p>
          <p>
            Figures are read live from our own index. Nothing here is cached marketing copy.
          </p>
        </div>
      </div>
    </footer>
  );
}
