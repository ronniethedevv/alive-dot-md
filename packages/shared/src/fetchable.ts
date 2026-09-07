// Is this URL safe for US to fetch on someone else's instruction?
//
// Anyone can register an ERC-8004 agent whose declared endpoint points at
// 127.0.0.1 or 169.254.169.254 and then ask the marketplace to verify it.
// Without this guard we make that request from inside our own network and hand
// the response back to the caller - a server-side request forgery with a public
// trigger and no authentication in front of it.
//
// It lived in packages/api/src/verify-now.ts, which also pulls in the RPC pool,
// the classifier and the database. The serverless verify path could not import
// it without dragging all of that into the bundle, so it shipped WITHOUT the
// guard - the vulnerability was reintroduced by a refactor that was only trying
// to avoid a dependency. It lives here now precisely so that cannot happen
// again: no imports, nothing to drag in, no excuse for a caller to skip it.

/** Hosts we refuse to fetch, whoever asks. */
const BLOCKED = [
  /^localhost$/i,
  /^127\./, /^0\./, /^10\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,            // link local, including cloud metadata
  /^\[?::1\]?$/, /^\[?fc00:/i, /^\[?fe80:/i,
  /\.internal$/i, /\.local$/i, /\.localdomain$/i,
];

/**
 * Hostnames that ENCODE an address rather than name a host.
 *
 * nip.io and friends resolve `10-0-0-1.nip.io` and `192.168.0.1.nip.io` to the
 * address written into the label, so a bare-IP check on the hostname string
 * misses them entirely. This catches the encoded forms before DNS is consulted.
 *
 * It does NOT close the general case - a hostname the registrant controls can
 * resolve anywhere, and only pinning the resolved address at connect time fixes
 * that. What it does is remove the trivial one-line bypass.
 */
const IP_ENCODING_HOST = /(?:^|[.-])(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})(?:$|[.-])/;

export function isFetchable(url: string): { ok: true } | { ok: false; why: string } {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, why: "not a valid URL" }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, why: "only http and https are fetched" };

  const host = u.hostname;
  if (BLOCKED.some((re) => re.test(host))) {
    return { ok: false, why: "endpoint points at a private or loopback address" };
  }
  // Bare IPv4 literals outside the blocked ranges are still refused: a public
  // agent should have a name, and this closes the decimal and octal encodings
  // that slip past a pattern match.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return { ok: false, why: "endpoint must be a hostname, not a raw IP address" };
  }

  const enc = IP_ENCODING_HOST.exec(host);
  if (enc) {
    const octets = enc.slice(1, 5).map(Number);
    const inRange = octets.every((o) => o >= 0 && o <= 255);
    const priv = octets[0] === 127 || octets[0] === 10 || octets[0] === 0
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
      || (octets[0] === 169 && octets[1] === 254);
    if (inRange && priv) {
      return { ok: false, why: "hostname encodes a private address" };
    }
  }
  return { ok: true };
}
