import { Link } from "react-router-dom";

/** Placeholder route so the landing page's links resolve. The real catalog is
 *  the next screen and is built against the same live API. */
export default function Catalog() {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="card max-w-md p-8 text-center">
        <p className="label">Next screen</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">The catalog is being built.</h1>
        <p className="mt-3 text-sm leading-relaxed text-dim">
          It lists the verified agents from the same index the landing page reads, with the
          hidden-count shown at all times.
        </p>
        <Link to="/" className="mt-6 inline-block font-mono text-xs text-verify hover:underline">
          ← back
        </Link>
      </div>
    </div>
  );
}
