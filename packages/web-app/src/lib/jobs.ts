/**
 * What this browser remembers about jobs it hired.
 *
 * This module exists because the key did not agree with itself. Hire.tsx wrote
 * `bnb-mrkt:hire:<agentId>` and cleared it on success; Jobs.tsx read
 * `bnb-mrkt:jobs`, which nothing ever wrote. The jobs list was therefore
 * structurally incapable of showing a job, including immediately after funding
 * one. One module now owns every key, so a writer and a reader cannot drift
 * apart again.
 *
 * Everything here is per browser and holds no secrets: a job id, a transaction
 * hash and a reason document are all public the moment they are mined.
 *
 * The honest limit, stated in the UI rather than hidden: this is a device
 * memory, not an account. Historical `eth_getLogs` is refused by every free BSC
 * endpoint we tested (DAY0-FINDINGS §4), so there is no way to ask the chain
 * "which jobs did this address create" without a token we do not have. A job
 * hired on another device still exists and can be opened by its number.
 */

const JOBS_KEY = "alive.md:jobs";
const REASON_KEY = (jobId: string) => `alive.md:reason:${jobId}`;

/**
 * Keys from before the rename, read once so a rename does not lose someone's
 * job list. Renaming a storage key is a silent data loss unless the old one is
 * still read, and a job id the browser forgets is a job the user can only
 * recover by remembering its number.
 */
const LEGACY_JOBS_KEY = "bnb-mrkt:jobs";
const LEGACY_REASON_KEY = (jobId: string) => `bnb-mrkt:reason:${jobId}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode, or the quota is full. Losing the note is survivable; the
       job itself lives on chain and can be opened by number. */
  }
}

/** Job ids this browser hired, newest first. */
export function rememberedJobIds(): string[] {
  const cur = read<unknown>(JOBS_KEY, []);
  const old = read<unknown>(LEGACY_JOBS_KEY, []);
  const merged = [
    ...(Array.isArray(cur) ? cur : []),
    ...(Array.isArray(old) ? old : []),
  ].filter((x): x is string => typeof x === "string");
  return [...new Set(merged)];
}

/**
 * Record a job id.
 *
 * Called the moment `createJob` is CONFIRMED, not when the whole flow finishes.
 * A job whose funding then failed is exactly the job the user most needs to
 * find again, so it must already be in the list by then.
 */
export function rememberJob(jobId: string) {
  const ids = rememberedJobIds().filter((id) => id !== jobId);
  write(JOBS_KEY, [jobId, ...ids].slice(0, 200));
}

export function forgetJob(jobId: string) {
  write(JOBS_KEY, rememberedJobIds().filter((id) => id !== jobId));
}

/**
 * The evaluator's reason document.
 *
 * Only the HASH goes on chain. A hash nobody can resolve to a document is not
 * accountability, it is a commitment to nothing, so when this browser is the
 * evaluator we keep the document it committed to and show it back on the job
 * screen. The job screen re-hashes it and only displays it when the digest
 * matches what the contract holds - a stored document that does not match the
 * chain is worse than none, and is never shown as if it did.
 */
export interface ReasonDoc {
  jobId: string;
  verdict: "complete" | "reject";
  reason: string;
  decidedAt: string;
  decidedBy: string;
}

export function saveReason(jobId: string, doc: ReasonDoc) {
  write(REASON_KEY(jobId), doc);
}

export function loadReason(jobId: string): ReasonDoc | null {
  return read<ReasonDoc | null>(REASON_KEY(jobId), null)
    ?? read<ReasonDoc | null>(LEGACY_REASON_KEY(jobId), null);
}

/**
 * The exact bytes the hash commits to.
 *
 * Key order is fixed here and nowhere else. `JSON.stringify` preserves
 * insertion order, so a document rebuilt from stored fields in a different
 * order would hash differently and read as a mismatch. One function builds it,
 * for both hashing and display.
 */
export function canonicalReason(doc: ReasonDoc): string {
  return JSON.stringify({
    jobId: doc.jobId,
    verdict: doc.verdict,
    reason: doc.reason,
    decidedAt: doc.decidedAt,
    decidedBy: doc.decidedBy,
  });
}
