import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * Focus and scroll management across client side navigation.
 *
 * A single page app does not reload, so the browser never moves focus or
 * resets scroll on navigation. Without this a keyboard user activates a link,
 * the page content swaps, and their focus is still on the old element at the
 * old scroll offset: they have to tab back through the entire header to reach
 * the content they just asked for.
 *
 * Announces the new page too, since a screen reader gets no navigation event.
 */
export function RouteFocus() {
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    // Do not steal focus on the very first paint; the user has not navigated.
    if (first.current) { first.current = false; return; }
    window.scrollTo({ top: 0, behavior: "auto" });
    const main = document.getElementById("main");
    if (main) {
      main.focus({ preventScroll: true });
    }
  }, [pathname]);

  return (
    <p aria-live="polite" className="sr-only">
      {`Navigated to ${pathname === "/" ? "home" : pathname.replace(/^\//, "").replace(/\//g, " ")}`}
    </p>
  );
}

/** First tab stop on every page, so the nav can be skipped. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-accent focus:px-5 focus:py-3 focus:text-sm focus:font-medium focus:text-[#04150C]"
    >
      Skip to content
    </a>
  );
}
