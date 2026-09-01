import { Link, NavLink } from "react-router-dom";
import { Compass, Briefcase, Wallet2, BookOpen, type LucideIcon } from "lucide-react";
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
  { to: "/catalog", label: "Browse", icon: Compass },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/wallet", label: "Wallet", icon: Wallet2 },
  { to: "/docs", label: "Learn", icon: BookOpen },
];

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`text-[1.05rem] font-bold tracking-tight ${className}`}>
      bnb<span className="text-accent">·</span>mrkt
    </Link>
  );
}

/** Persistent left rail. Desktop only. */
function SideNav() {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-[248px] flex-col border-r border-line bg-surface/40 px-4 py-6 lg:flex">
      <Wordmark className="px-3" />

      <nav aria-label="Primary" className="mt-8 flex-1">
        <ul className="space-y-1">
          {DESTINATIONS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `flex min-h-[46px] items-center gap-3 rounded-xl px-3 text-[0.95rem] font-medium transition-colors ${
                    isActive
                      ? "bg-accent-soft text-accent"
                      : "text-dim hover:bg-raised hover:text-ink"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className="size-5 shrink-0" strokeWidth={isActive ? 2.3 : 1.8} />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-line pt-4">
        <WalletButton />
        <p className="mt-4 px-1 text-[0.72rem] leading-relaxed text-faint">
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
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ground/95 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="mx-auto flex max-w-lg">
        {DESTINATIONS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              className={({ isActive }) =>
                `flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 transition-colors ${
                  isActive ? "text-accent" : "text-faint hover:text-dim"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="size-[22px]" strokeWidth={isActive ? 2.4 : 1.8} />
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
  children, title, wide = false,
}: { children: React.ReactNode; title?: string; wide?: boolean }) {
  return (
    <div className="min-h-screen lg:pl-[248px]">
      <SideNav />

      {/* Mobile top bar. Identity and wallet only: navigation is at the bottom,
          so repeating it here would waste the scarcest space on the screen. */}
      <header className="sticky top-0 z-40 border-b border-line bg-ground/90 px-4 backdrop-blur-xl lg:hidden">
        <div className="flex h-14 items-center gap-3">
          <Wordmark className="text-[0.95rem]" />
          <div className="ml-auto"><WalletButton /></div>
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className={`mx-auto px-4 pt-6 lg:px-10 lg:pt-10 ${wide ? "max-w-6xl" : "max-w-3xl"}`}
      >
        {title && (
          <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight lg:text-[2.1rem]">
            {title}
          </h1>
        )}
        {children}
      </main>

      <div aria-hidden className="h-24 lg:h-12" />
      <TabBar />
    </div>
  );
}
