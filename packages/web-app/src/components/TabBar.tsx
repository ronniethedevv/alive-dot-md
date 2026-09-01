import { NavLink } from "react-router-dom";
import { Compass, Briefcase, Wallet2, BookOpen } from "lucide-react";

/**
 * Bottom tab bar: the primary navigation on this app.
 *
 * Consumer apps put navigation in the thumb zone, the bottom third of the
 * screen plus a curve up the dominant side. Everything above the midpoint needs
 * a grip shift or a second hand, which is why a row of text links in a top bar
 * reads as a desktop tool rather than something you use one handed on a phone.
 *
 * Four destinations, which is the usual sweet spot: three to five keeps each
 * target wide enough to hit. Each is 44px tall at minimum, matching the Apple
 * and Android floor for touch targets, and carries an icon AND a label because
 * icon only navigation is guesswork for anyone who has not learned the app.
 *
 * It hides on large screens, where a pointer makes the top bar the better home.
 */

const TABS = [
  { to: "/catalog", label: "Browse", icon: Compass },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/wallet", label: "Wallet", icon: Wallet2 },
  { to: "/docs", label: "Learn", icon: BookOpen },
];

export function TabBar() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ground/95 backdrop-blur-xl lg:hidden"
      // Sit above the home indicator on phones that have one.
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="mx-auto flex max-w-lg">
        {TABS.map(({ to, label, icon: Icon }) => (
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

/** Spacer so fixed bottom chrome never covers the last row of content. */
export function TabBarSpacer() {
  return <div aria-hidden className="h-20 lg:hidden" />;
}
