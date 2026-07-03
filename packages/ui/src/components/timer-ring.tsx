/** One shared 30s countdown ring for all TOTP codes (mirrors Swift `timerRing`).
 * 22x22, 2.5px stroke, tint trim = secondsLeft/period, secondsLeft centered. */
export function TimerRing({ now, period = 30 }: { now: number; period?: number }) {
  const secondsLeft = period - (Math.floor(now / 1000) % period);
  const r = 9;
  const circumference = 2 * Math.PI * r;
  const filled = (secondsLeft / period) * circumference;

  return (
    <div className="relative size-[22px] shrink-0">
      <svg width={22} height={22} className="-rotate-90">
        <circle cx={11} cy={11} r={r} fill="none" stroke="var(--color-muted)" strokeWidth={2.5} />
        <circle
          cx={11}
          cy={11}
          r={r}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - filled}
          style={{ transition: "stroke-dashoffset 0.2s linear" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] tabular-nums text-muted-foreground">
        {secondsLeft}
      </span>
    </div>
  );
}
