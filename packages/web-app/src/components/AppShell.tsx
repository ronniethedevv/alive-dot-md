import { Link, NavLink } from "react-router-dom";
import { Sparkles, Compass, Building2, Briefcase, Wallet2, BookOpen, type LucideIcon } from "lucide-react";
import { WalletButton } from "./Wallet.tsx";

/**
 * The app shell.
 *
 * Two real layouts rather than one layout with pieces hidden.
 *
 * On a phone, navigation sits in the thumb zone as a bottom tab bar, because
 * anything above the screen midpoint needs a grip shift or a second hand.
 *
 * On a desktop there is no thumb and no reach constraint, and a bar pinned to
 * the bottom of a 1400px window is just far away. So the same destinations
 * become a persistent left rail, which is what every desktop app of this shape
 * does: the navigation is always visible, never costs a tap to reach, and the
 * content gets a comfortable measure beside it rather than the full width.
 */

interface Dest { to: string; label: string; icon: LucideIcon }

const DESTINATIONS: Dest[] = [
  // The concierge leads: TermiX scores "find, compare, hire, WITHOUT
  // instructions", and describing a need is the shortest path to a funded job.
  { to: "/start", label: "Describe a job", icon: Sparkles },
  { to: "/catalog", label: "Browse", icon: Compass },
  { to: "/operators", label: "Operators", icon: Building2 },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/wallet", label: "Wallet", icon: Wallet2 },
  { to: "/docs", label: "Learn", icon: BookOpen },
];

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link
      to="/"
      className={`font-mono text-[0.92rem] font-semibold tracking-tight text-ink ${className}`}
    >
      ALIVE<span className="text-accent">.</span>MD
    </Link>
  );
}

/** Persistent left rail. Desktop only. */
function SideNav() {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-[236px] flex-col border-r border-line px-5 py-7 lg:flex">
      <Wordmark className="px-2.5" />

      <nav aria-label="Primary" className="mt-10 flex-1">
        <ul className="space-y-0.5">
          {DESTINATIONS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `flex min-h-[38px] items-center gap-2.5 rounded-md px-2.5 text-[0.88rem] transition-colors ${
                    isActive
                      ? "bg-surface font-medium text-ink"
                      : "text-dim hover:bg-surface/60 hover:text-ink"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={`size-4 shrink-0 ${isActive ? "text-accent" : "text-faint"}`}
                      strokeWidth={1.75}
                    />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-line pt-5">
        <WalletButton />
        <p className="mt-4 px-0.5 text-[0.72rem] leading-relaxed text-faint">
          Escrow settles in U on BNB Smart Chain. Your wallet signs every payment.
        </p>
      </div>
    </aside>
  );
}

/** Bottom tabs. Phone and tablet only. */
function TabBar() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ground/90 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="mx-auto flex max-w-lg">
        {DESTINATIONS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              className={({ isActive }) =>
                `flex min-h-[54px] flex-col items-center justify-center gap-1 px-1 py-2 transition-colors ${
                  isActive ? "text-ink" : "text-faint hover:text-dim"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={`size-[19px] ${isActive ? "text-accent" : ""}`}
                    strokeWidth={1.75}
                  />
                  <span className="text-[0.68rem] font-medium">{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Wraps a screen in whichever navigation suits the viewport.
 *
 * `wide` opts a screen out of the reading measure, for the catalog where a
 * desktop window can show more per row.
 */
export function AppShell({
  children, title, lede, actions, wide = false,
}: {
  children: React.ReactNode;
  title?: string;
  /** One line under the title. Given here rather than as the first child so
   *  every screen's header block has identical spacing and measure. */
  lede?: React.ReactNode;
  /** Controls that belong to the page rather than to its content. */
  actions?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen lg:pl-[236px]">
      <SideNav />

      {/* Mobile top bar. Identity and wallet only: navigation is at the bottom,
          so repeating it here would waste the scarcest space on the screen. */}
      <header className="sticky top-0 z-40 border-b border-line bg-ground/90 px-5 backdrop-blur-xl lg:hidden">
        <div className="flex h-14 items-center gap-3">
          <Wordmark />
          <div className="ml-auto"><WalletButton /></div>
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className={`mx-auto px-5 pt-10 lg:px-12 lg:pt-14 ${wide ? "max-w-[1080px]" : "max-w-[760px]"}`}
      >
        {/* One page-header block, so the distance from title to content is the
            same on every screen. The rule under it is what separates the header
            from the page instead of a change of background. */}
        {title && (
          <header className="mb-8 border-b border-line pb-6 lg:mb-10 lg:pb-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-[1.6rem] font-semibold lg:text-[1.9rem]">{title}</h1>
                {lede && (
                  <p className="mt-2 max-w-xl text-[0.92rem] leading-relaxed text-dim">{lede}</p>
                )}
              </div>
              {actions && <div className="shrink-0">{actions}</div>}
            </div>
          </header>
        )}
        {children}
      </main>

      <div aria-hidden className="h-24 lg:h-20" />
      <TabBar />
    </div>
  );
}
