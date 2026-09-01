/**
 * Score as a ring. Real value only, 0 to 100 from the API.
 *
 * Deliberately NOT a sparkline. Coinbase asset rows carry price history, we
 * have no time series for an agent, and drawing a plausible squiggle would be
 * inventing data on the one screen whose entire claim is that we do not.
 * A ring shows the single number we actually hold.
 *
 * The arc is set from the value in the initial render, so it is correct with no
 * script, no observer and no animation. The transition only eases changes.
 */
export function ScoreRing({
  value, size = 40, stroke = 3.5, showValue = true,
}: { value: number; size?: number; stroke?: number; showValue?: boolean }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * c;

  return (
    <span
      className="relative inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Score ${pct} of 100`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="var(--color-line)" strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="var(--color-accent)" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      {showValue && (
        <span className="absolute font-mono text-[0.68rem] text-ink tnum">{pct}</span>
      )}
    </span>
  );
}
